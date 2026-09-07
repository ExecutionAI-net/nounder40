"""What a teacher may do in her panel beyond her own lessons.

The two grants live on the teacher-school link (`TeacherSchool`) and are
switched on by the school from School → Teachers: the same person can be
"staff" at one school and a plain teacher at another.

- `can_view_all_lessons`: her calendar shows every lesson of the school and
  she takes attendance for colleagues' lessons too;
- `can_manage_bookings`: she adds and removes students on a lesson (same
  service as the manual enrolment from the school panel).

Own lessons are always visible and markable; the grants only widen. An
inactive link (`active=False`) grants nothing.
"""

from django.db.models import Q

from .models import TeacherSchool


def staff_school_ids(teacher, flag: str) -> set:
    """School ids where this teacher's active link carries the given flag."""
    return set(
        TeacherSchool.objects.filter(teacher=teacher, active=True, **{flag: True}).values_list("school_id", flat=True)
    )


def visible_lessons_q(teacher) -> Q:
    """Own lessons, plus every lesson of the schools where she is staff."""
    q = Q(teacher=teacher)
    schools = staff_school_ids(teacher, "can_view_all_lessons")
    if schools:
        q |= Q(school_id__in=schools)
    return q


def can_view_lesson(teacher, lesson) -> bool:
    if lesson.teacher_id == teacher.id:
        return True
    return TeacherSchool.objects.filter(
        teacher=teacher, school_id=lesson.school_id, active=True, can_view_all_lessons=True
    ).exists()


def can_manage_bookings(teacher, lesson) -> bool:
    """Adding/removing students needs the grant AND a lesson she can see
    (her own, or the school's when she views all)."""
    if not can_view_lesson(teacher, lesson):
        return False
    return TeacherSchool.objects.filter(
        teacher=teacher, school_id=lesson.school_id, active=True, can_manage_bookings=True
    ).exists()
