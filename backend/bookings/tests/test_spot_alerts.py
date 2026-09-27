""""Notify me if a spot frees up" (WAITLIST_ALERTS_AND_VIP.md §2.1).

Not a queue: a full lesson of a course with `waitlist_enabled` lets a student
ask for one email when a seat opens; every student waiting gets it at once,
the seat goes to whoever books first, and the rows are forgotten. A lesson
that is cancelled or already started drops its rows without a word.
"""
import uuid
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from bookings.models import Booking, LessonSpotAlert
from bookings.services import (
    BookingError,
    add_spot_alert,
    book_lesson,
    cancel_booking,
    notify_spot_available,
    remove_spot_alert,
    staff_unenrol,
)
from catalog.models import Course, Lesson
from schools.models import School, SchoolClosure, SchoolMembership
from students.models import Student

pytestmark = pytest.mark.django_db

SEND = "notifications.tasks.send_transactional_email_task.delay"
QUEUE = "notifications.tasks.spot_available_task.delay"


@pytest.fixture
def school():
    # Every first booking is free: the tests fill seats without packages
    return School.objects.create(
        name="Scuola", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True,
        free_first_lesson=True, cancellation_policy_hours=24, min_booking_notice_hours=0,
    )


def _student(school, *, language="it"):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Anna Rossi", first_name="Anna", school=school, language_preference=language)


@pytest.fixture
def anna(school):
    return _student(school)


@pytest.fixture
def bea(school):
    return _student(school, language="en")


def _lesson(school, *, waitlist=True, capacity=1, days=3, at=None, **extra):
    """`at`: a datetime in the school's own zone, for lessons close to now."""
    course = Course.objects.create(school=school, name="Sbarra a terra", waitlist_enabled=waitlist, min_booking_notice_hours=0)
    if at is None:
        day, start = timezone.localdate() + timedelta(days=days), time(18, 0)
    else:
        day, start = at.date(), at.time().replace(second=0, microsecond=0)
    end = (datetime.combine(day, start) + timedelta(minutes=30)).time()
    return Lesson.objects.create(
        school=school, course=course, date=day, start_time=start, end_time=end, max_capacity=capacity, **extra
    )


def _in_school_tz(school, **delta):
    return timezone.now().astimezone(ZoneInfo(school.timezone or "UTC")) + timedelta(**delta)


def _full_lesson(school, **kw):
    """One seat, taken by someone else."""
    lesson = _lesson(school, **kw)
    book_lesson(_student(school), lesson)
    lesson.refresh_from_db()
    assert lesson.current_bookings == lesson.max_capacity
    return lesson


def _jwt(user):
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


# --- asking ------------------------------------------------------------------


def test_only_a_full_lesson_of_a_waitlist_course_takes_an_alert(school, anna):
    with pytest.raises(BookingError, match="not_full"):
        add_spot_alert(anna, _lesson(school))
    with pytest.raises(BookingError, match="waitlist_disabled"):
        add_spot_alert(anna, _full_lesson(school, waitlist=False))
    with pytest.raises(BookingError, match="lesson_already_started"):
        add_spot_alert(anna, _full_lesson(school, days=-1))

    lesson = _full_lesson(school)
    add_spot_alert(anna, lesson)
    add_spot_alert(anna, lesson)  # asking twice is one row
    assert LessonSpotAlert.objects.filter(student=anna, lesson=lesson).count() == 1
    assert LessonSpotAlert.objects.get(student=anna, lesson=lesson).school_id == school.id


def test_a_student_already_in_cannot_wait_for_herself(school, anna):
    lesson = _lesson(school)
    book_lesson(anna, lesson)
    lesson.refresh_from_db()
    with pytest.raises(BookingError, match="already_booked"):
        add_spot_alert(anna, lesson)


def test_a_cancelled_lesson_takes_no_alert(school, anna):
    lesson = _full_lesson(school)
    lesson.status = "cancelled"
    lesson.save(update_fields=["status"])
    with pytest.raises(BookingError, match="lesson_not_bookable"):
        add_spot_alert(anna, lesson)


def test_no_alert_when_nobody_could_book_any_more(school, anna):
    # Inside the course's notice window: a seat could open, nobody could take it
    soon = _full_lesson(school, at=_in_school_tz(school, hours=1))
    soon.course.min_booking_notice_hours = 2
    soon.course.save(update_fields=["min_booking_notice_hours"])
    with pytest.raises(BookingError, match="min_notice"):
        add_spot_alert(anna, soon)
    # A closure day
    closed = _full_lesson(school)
    SchoolClosure.objects.create(school=school, date=closed.date)
    with pytest.raises(BookingError, match="school_closed"):
        add_spot_alert(anna, closed)


# --- a seat opens ------------------------------------------------------------


def test_a_student_cancelling_queues_the_check_after_commit(school, anna, django_capture_on_commit_callbacks):
    lesson = _lesson(school)
    booking = book_lesson(_student(school), lesson)
    lesson.refresh_from_db()
    add_spot_alert(anna, lesson)

    with patch(QUEUE) as queue, django_capture_on_commit_callbacks(execute=True):
        cancel_booking(booking)

    queue.assert_called_once_with(str(lesson.id))


def test_nobody_waiting_means_nothing_queued(school, django_capture_on_commit_callbacks):
    lesson = _lesson(school)
    booking = book_lesson(_student(school), lesson)
    with patch(QUEUE) as queue, django_capture_on_commit_callbacks(execute=True):
        cancel_booking(booking)
    queue.assert_not_called()


def test_the_school_taking_a_student_off_queues_the_check(school, anna, django_capture_on_commit_callbacks):
    lesson = _lesson(school)
    other = _student(school)
    book_lesson(other, lesson)
    lesson.refresh_from_db()
    add_spot_alert(anna, lesson)
    with patch(QUEUE) as queue, django_capture_on_commit_callbacks(execute=True):
        staff_unenrol(lesson, other.id)
    queue.assert_called_once_with(str(lesson.id))


def test_a_deleted_booking_row_queues_the_check(school, anna, django_capture_on_commit_callbacks):
    # The post_delete signal path (a student account deleted takes her
    # bookings with it): the seat opens without any cancellation call.
    lesson = _lesson(school)
    booking = book_lesson(_student(school), lesson)
    lesson.refresh_from_db()
    add_spot_alert(anna, lesson)
    with patch(QUEUE) as queue, django_capture_on_commit_callbacks(execute=True):
        booking.delete()
    queue.assert_called_once_with(str(lesson.id))


# --- the emails --------------------------------------------------------------


def test_everyone_waiting_is_emailed_in_her_language_and_forgotten(school, anna, bea, django_capture_on_commit_callbacks):
    lesson = _lesson(school)
    booking = book_lesson(_student(school), lesson)
    lesson.refresh_from_db()
    add_spot_alert(anna, lesson)
    add_spot_alert(bea, lesson)
    cancel_booking(booking)  # the seat is open now

    with patch(SEND) as send, django_capture_on_commit_callbacks(execute=True):
        sent = notify_spot_available(lesson.id)

    assert sent == 2 and send.call_count == 2
    by_email = {c.kwargs["to_email"]: c.kwargs for c in send.call_args_list}
    it = by_email[anna.user.email]
    assert it["key"] == "spot_available" and it["locale"] == "it" and it["school_id"] == str(school.id)
    assert it["context"]["lesson_name"] == "Sbarra a terra"
    assert it["context"]["student_first_name"] == "Anna"
    assert f"date={lesson.date.isoformat()}" in it["context"]["lesson_url"]
    assert by_email[bea.user.email]["locale"] == "en"
    assert not LessonSpotAlert.objects.filter(lesson=lesson).exists()


def test_an_online_lesson_uses_the_online_variant(school, anna, django_capture_on_commit_callbacks):
    lesson = _lesson(school, is_online=True, online_link="https://zoom.example/x")
    booking = book_lesson(_student(school), lesson)
    lesson.refresh_from_db()
    add_spot_alert(anna, lesson)
    cancel_booking(booking)
    with patch(SEND) as send, django_capture_on_commit_callbacks(execute=True):
        notify_spot_available(lesson.id)
    assert send.call_args.kwargs["key"] == "student.spot_available.online"
    assert send.call_args.kwargs["context"]["online_link"] == "https://zoom.example/x"


def test_a_lesson_full_again_keeps_the_alerts_for_next_time(school, anna, django_capture_on_commit_callbacks):
    # Someone booked between the seat opening and the worker running
    lesson = _full_lesson(school)
    add_spot_alert(anna, lesson)
    with patch(SEND) as send, django_capture_on_commit_callbacks(execute=True):
        assert notify_spot_available(lesson.id) == 0
    send.assert_not_called()
    assert LessonSpotAlert.objects.filter(student=anna, lesson=lesson).exists()


def test_a_cancelled_or_past_lesson_drops_the_alerts_silently(school, anna, bea, django_capture_on_commit_callbacks):
    lesson = _full_lesson(school)
    add_spot_alert(anna, lesson)
    lesson.status = "cancelled"
    lesson.current_bookings = 0
    lesson.save(update_fields=["status", "current_bookings"])
    with patch(SEND) as send, django_capture_on_commit_callbacks(execute=True):
        assert notify_spot_available(lesson.id) == 0
    send.assert_not_called()
    assert not LessonSpotAlert.objects.filter(lesson=lesson).exists()

    past = _full_lesson(school)
    LessonSpotAlert.objects.create(student=bea, lesson=past, school=school)
    past.date = timezone.localdate() - timedelta(days=1)
    past.current_bookings = 0
    past.save(update_fields=["date", "current_bookings"])
    with patch(SEND) as send, django_capture_on_commit_callbacks(execute=True):
        assert notify_spot_available(past.id) == 0
    assert not LessonSpotAlert.objects.filter(lesson=past).exists()


def test_the_task_drops_the_rows_when_nobody_could_book_any_more(school, anna, django_capture_on_commit_callbacks):
    def armed_and_open(**kw):
        lesson = _lesson(school, **kw)
        booking = book_lesson(_student(school), lesson)
        lesson.refresh_from_db()
        add_spot_alert(anna, lesson)
        cancel_booking(booking)  # the seat is open now
        return lesson

    soon, closed, off = armed_and_open(at=_in_school_tz(school, hours=1)), armed_and_open(days=3), armed_and_open(days=4)
    # ...but the notice window closed meanwhile
    soon.course.min_booking_notice_hours = 2
    soon.course.save(update_fields=["min_booking_notice_hours"])
    # ...but the school added a closure on that day
    SchoolClosure.objects.create(school=school, date=closed.date)
    # ...but the school switched the alert off on the course
    off.course.waitlist_enabled = False
    off.course.save(update_fields=["waitlist_enabled"])

    for lesson in (soon, closed, off):
        with patch(SEND) as send, django_capture_on_commit_callbacks(execute=True):
            assert notify_spot_available(lesson.id) == 0
        send.assert_not_called()
        assert not LessonSpotAlert.objects.filter(lesson=lesson).exists()


def test_the_school_cancelling_the_lesson_spends_the_alerts(school, anna, django_capture_on_commit_callbacks):
    lesson = _full_lesson(school)
    add_spot_alert(anna, lesson)
    api = _owner_client(school)
    with patch(QUEUE) as queue, django_capture_on_commit_callbacks(execute=True):
        r = api.delete(f"/api/school/classes/{lesson.id}/")
    assert r.status_code == 200, r.content
    assert queue.called and {c.args[0] for c in queue.call_args_list} == {str(lesson.id)}
    with patch(SEND) as send, django_capture_on_commit_callbacks(execute=True):
        assert notify_spot_available(lesson.id) == 0
    send.assert_not_called()
    assert not LessonSpotAlert.objects.filter(lesson=lesson).exists()


def test_putting_a_cancelled_lesson_back_on_queues_the_check(school, anna, django_capture_on_commit_callbacks):
    lesson = _full_lesson(school)
    add_spot_alert(anna, lesson)
    Booking.objects.filter(lesson=lesson).update(status="cancelled")
    lesson.current_bookings = 0
    lesson.status = "cancelled"
    lesson.save()
    with patch(QUEUE) as queue, django_capture_on_commit_callbacks(execute=True):
        lesson.status = "scheduled"
        lesson.save(update_fields=["status"])
    queue.assert_called_once_with(str(lesson.id))
    with patch(QUEUE) as queue, django_capture_on_commit_callbacks(execute=True):
        lesson.notes = "nothing to do with seats"
        lesson.save(update_fields=["notes"])
    queue.assert_not_called()


def test_a_student_who_got_in_on_her_own_is_not_emailed(school, anna, django_capture_on_commit_callbacks):
    lesson = _lesson(school, capacity=2)
    booking = book_lesson(_student(school), lesson)
    other = book_lesson(_student(school), lesson)
    lesson.refresh_from_db()
    add_spot_alert(anna, lesson)
    cancel_booking(booking)
    lesson.refresh_from_db()
    book_lesson(anna, lesson)  # she took the seat herself: the row is gone already
    assert not LessonSpotAlert.objects.filter(student=anna, lesson=lesson).exists()
    cancel_booking(other)
    with patch(SEND) as send, django_capture_on_commit_callbacks(execute=True):
        assert notify_spot_available(lesson.id) == 0
    send.assert_not_called()


# --- the API -----------------------------------------------------------------


def test_the_student_api_asks_lists_and_forgets(school, anna):
    lesson = _full_lesson(school)
    api = _jwt(anna.user)

    r = api.post(f"/api/student/lessons/{lesson.id}/spot-alert/")
    assert r.status_code == 201 and r.json() == {"lesson": str(lesson.id)}
    assert api.get("/api/student/spot-alerts/").json() == {"lessons": [str(lesson.id)]}

    assert api.delete(f"/api/student/lessons/{lesson.id}/spot-alert/").status_code == 204
    assert api.get("/api/student/spot-alerts/").json() == {"lessons": []}
    assert api.delete(f"/api/student/lessons/{lesson.id}/spot-alert/").status_code == 204  # idempotent


def test_the_student_api_says_why_not(school, anna):
    api = _jwt(anna.user)
    r = api.post(f"/api/student/lessons/{_lesson(school).id}/spot-alert/")
    assert r.status_code == 400 and r.json() == {"error": "not_full"}
    assert api.post(f"/api/student/lessons/{uuid.uuid4()}/spot-alert/").status_code == 404
    assert APIClient().post(f"/api/student/lessons/{_lesson(school).id}/spot-alert/").status_code == 401


def test_the_booking_feed_tells_whether_the_course_offers_the_alert(school):
    _full_lesson(school)
    r = APIClient().get("/api/student/lessons/", {"school_id": str(school.id)})
    assert r.status_code == 200
    assert r.json()["results"][0]["courses"]["waitlist_enabled"] is True


def _owner_client(school):
    user = get_user_model().objects.create(
        email=f"owner-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    return _jwt(user)


def test_the_school_calendar_counts_the_students_waiting(school, anna, bea):
    lesson = _full_lesson(school)
    add_spot_alert(anna, lesson)
    add_spot_alert(bea, lesson)
    r = _owner_client(school).get("/api/school/lessons-feed/", {"from": lesson.date.isoformat(), "to": lesson.date.isoformat()})
    assert r.status_code == 200, r.content
    assert [row["waiting"] for row in r.json() if row["id"] == str(lesson.id)] == [2]


def test_the_school_raising_the_capacity_queues_the_check(school, anna, django_capture_on_commit_callbacks):
    lesson = _full_lesson(school)
    add_spot_alert(anna, lesson)
    api = _owner_client(school)
    with patch(QUEUE) as queue, django_capture_on_commit_callbacks(execute=True):
        r = api.patch(f"/api/school/classes/{lesson.id}/", {"max_capacity": 2}, format="json")
    assert r.status_code == 200, r.content
    queue.assert_called_once_with(str(lesson.id))
    with patch(QUEUE) as queue, django_capture_on_commit_callbacks(execute=True):
        api.patch(f"/api/school/classes/{lesson.id}/", {"max_capacity": 2}, format="json")  # unchanged: nothing
    queue.assert_not_called()


def test_the_lesson_going_takes_its_alerts_with_it(school, anna):
    lesson = _full_lesson(school)
    add_spot_alert(anna, lesson)
    Booking.objects.filter(lesson=lesson).delete()
    lesson.delete()
    assert not LessonSpotAlert.objects.filter(student=anna).exists()
    assert remove_spot_alert(anna, uuid.uuid4()) is False
