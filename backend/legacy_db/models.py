"""
Reverse-engineered from the live Supabase Postgres schema via `inspectdb`
(see the Faz 0 commit for the raw dump). All models are `managed = False` —
Django never creates/alters/drops these tables. Ownership of the schema
stays with the Supabase SQL migrations until the final Auth+DB cutover
phase of the Supabase -> Django migration.

Cleanup applied on top of the raw inspectdb output:
  * TEXT[] columns -> ArrayField (was guessed as TextField)
  * jsonb columns -> JSONField
  * Postgres enum columns (user_role, school_sub_role) -> TextField + choices
  * DecimalField calls missing max_digits/decimal_places (arbitrary-precision
    `numeric` columns) given explicit precision (max_digits=10, decimal_places=2,
    matching every other money field in this schema)
  * Renamed the two FK/column-name-clash fields inspectdb auto-suffixed
    with `_0` to something readable (db_column kept identical)
  * Deduplicated one accidental duplicate unique_together entry
  * Fixed mangled non-ASCII characters in a couple of db_comment values
    (Windows console encoding artifact from the raw inspectdb run, not a
    real data issue)

`models.DB_CASCADE` / `models.DB_SET_NULL` mean "let Postgres's own FK
ON DELETE action run" (this schema's actual constraint, e.g. from
supabase/migrations/030_school_rooms_write_fk.sql) rather than emulating
the cascade in Python.
"""
import uuid

from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.utils import timezone


ROLE_CHOICES = [
    ('hq', 'HQ'),
    ('school', 'School'),
    ('teacher', 'Teacher'),
    ('student', 'Student'),
]

HQ_SUB_ROLE_CHOICES = [
    ('super_admin', 'Super Admin'),
    ('operations', 'Operations'),
    ('tech_support', 'Tech Support'),
    ('analytics', 'Analytics'),
    ('support', 'Support'),
]

SCHOOL_SUB_ROLE_CHOICES = [
    ('admin', 'Admin'),
    ('staff', 'Staff'),
    ('owner', 'Owner'),
]


# --- Platform / HQ --------------------------------------------------------

class PlatformSettings(models.Model):
    key = models.TextField(primary_key=True)
    value = models.TextField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'platform_settings'


class HqCountries(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    name = models.TextField()
    code = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        managed = False
        db_table = 'hq_countries'


class HqCities(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    country = models.ForeignKey(HqCountries, models.DB_CASCADE)
    name = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        managed = False
        db_table = 'hq_cities'


class HqRoles(models.Model):
    key = models.TextField(primary_key=True)
    label = models.TextField()
    builtin = models.BooleanField()
    permissions = ArrayField(models.TextField())
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        managed = False
        db_table = 'hq_roles'


# --- Schools ---------------------------------------------------------------

class Schools(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    name = models.TextField()
    slug = models.TextField(unique=True)
    email = models.TextField()
    phone = models.TextField(blank=True, null=True)
    address = models.TextField(blank=True, null=True)
    city = models.TextField(blank=True, null=True)
    country = models.TextField(blank=True, null=True)
    logo_url = models.TextField(blank=True, null=True)
    active = models.BooleanField()
    platform_fee_percentage = models.DecimalField(max_digits=5, decimal_places=2)
    stripe_account_id = models.TextField(blank=True, null=True)
    stripe_onboarding_complete = models.BooleanField()
    ical_token = models.UUIDField()
    free_trial_ends_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    grace_period_days = models.IntegerField()
    user_id = models.UUIDField(blank=True, null=True)
    language = models.TextField()
    address_line2 = models.TextField(blank=True, null=True)
    province = models.TextField(blank=True, null=True)
    vat_number = models.TextField(blank=True, null=True)
    website = models.TextField(blank=True, null=True)
    cancellation_policy_hours = models.IntegerField()
    free_first_lesson = models.BooleanField()
    min_booking_notice_hours = models.IntegerField()
    shop_commission_percentage = models.DecimalField(
        max_digits=5, decimal_places=2,
        db_comment='Percentuale riconosciuta alla scuola sulle vendite shop ai suoi studenti',
    )
    show_teacher_to_students = models.BooleanField()
    block_booking_on_documents = models.BooleanField(
        db_comment='true = niente prenotazione senza documenti obbligatori validi; false = solo avviso',
    )

    class Meta:
        managed = False
        db_table = 'schools'


class SchoolLocations(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    name = models.TextField()
    address = models.TextField(blank=True, null=True)
    google_maps_url = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    phone = models.TextField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'school_locations'


class SchoolRooms(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    location = models.ForeignKey(SchoolLocations, models.DB_CASCADE)
    name = models.TextField()
    capacity = models.IntegerField()
    created_at = models.DateTimeField(default=timezone.now)
    cost = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        managed = False
        db_table = 'school_rooms'


class SchoolClosures(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    date = models.DateField()
    type = models.TextField()
    from_time = models.TimeField(blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    end_date = models.DateField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'school_closures'
        unique_together = (('school', 'date'),)


class SchoolDocumentTypes(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    code = models.TextField()
    name = models.TextField()
    variants = ArrayField(models.TextField())
    has_expiry = models.BooleanField()
    required = models.BooleanField()
    sort_order = models.IntegerField()
    active = models.BooleanField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        managed = False
        db_table = 'school_document_types'
        unique_together = (('school', 'code'),)


# --- People ------------------------------------------------------------

class Profiles(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    email = models.TextField()
    name = models.TextField()
    role = models.TextField(choices=ROLE_CHOICES)
    hq_sub_role = models.TextField(blank=True, null=True, choices=HQ_SUB_ROLE_CHOICES)
    school_sub_role = models.TextField(blank=True, null=True, choices=SCHOOL_SUB_ROLE_CHOICES)
    school = models.ForeignKey(Schools, models.DB_SET_NULL, blank=True, null=True)
    language_preference = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)
    roles = ArrayField(models.TextField(), blank=True, null=True)
    phone = models.TextField(blank=True, null=True)
    city = models.TextField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'profiles'


class HqMembers(models.Model):
    id = models.OneToOneField(Profiles, models.DB_CASCADE, db_column='id', primary_key=True)
    email = models.TextField()
    name = models.TextField()
    sub_role = models.TextField(choices=HQ_SUB_ROLE_CHOICES)
    active = models.BooleanField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        managed = False
        db_table = 'hq_members'


class Students(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    user_id = models.UUIDField(unique=True)
    name = models.TextField()
    email = models.TextField()
    phone = models.TextField(blank=True, null=True)
    date_of_birth = models.DateField(blank=True, null=True)
    address = models.TextField(blank=True, null=True)
    city = models.TextField(blank=True, null=True)
    country = models.TextField(blank=True, null=True)
    language_preference = models.TextField()
    badge = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    school = models.ForeignKey(Schools, models.DB_SET_NULL, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'students'


class SchoolStudents(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    student = models.ForeignKey(Students, models.DB_CASCADE)
    free_lesson_used = models.BooleanField()
    enrolled_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'school_students'
        unique_together = (('school', 'student'),)


class Teachers(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    user_id = models.UUIDField(unique=True, blank=True, null=True)
    name = models.TextField()
    email = models.TextField()
    phone = models.TextField(blank=True, null=True)
    address = models.TextField(blank=True, null=True)
    bio = models.TextField(blank=True, null=True)
    photo_url = models.TextField(blank=True, null=True)
    active = models.BooleanField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        managed = False
        db_table = 'teachers'


class TeacherSchools(models.Model):
    pk = models.CompositePrimaryKey('teacher_id', 'school_id')
    teacher = models.ForeignKey(Teachers, models.DB_CASCADE)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    compensation_plan_id = models.UUIDField(blank=True, null=True)
    active = models.BooleanField()

    class Meta:
        managed = False
        db_table = 'teacher_schools'


class SchoolMemberships(models.Model):
    pk = models.CompositePrimaryKey('profile_id', 'school_id')
    profile = models.ForeignKey(Profiles, models.DB_CASCADE)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    sub_role = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        managed = False
        db_table = 'school_memberships'


class PendingInvitations(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    type = models.TextField()
    name = models.TextField()
    email = models.TextField()
    role_detail = models.TextField(blank=True, null=True)
    school_id = models.UUIDField(blank=True, null=True)
    phone = models.TextField(blank=True, null=True)
    invited_by = models.UUIDField(blank=True, null=True)
    created_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'pending_invitations'


# --- Lesson catalog / scheduling ----------------------------------------

class LessonTypes(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    code = models.TextField(unique=True)
    name_it = models.TextField()
    name_en = models.TextField()
    name_fr = models.TextField()
    name_es = models.TextField()
    level = models.TextField(blank=True, null=True)
    description_it = models.TextField(blank=True, null=True)
    description_en = models.TextField(blank=True, null=True)
    active = models.BooleanField()
    created_at = models.DateTimeField(default=timezone.now)
    image_url = models.TextField(blank=True, null=True)
    video_url_it = models.TextField(blank=True, null=True)
    video_url_en = models.TextField(blank=True, null=True)
    video_url_fr = models.TextField(blank=True, null=True)
    video_url_es = models.TextField(blank=True, null=True)
    description_fr = models.TextField(blank=True, null=True)
    description_es = models.TextField(blank=True, null=True)
    image_url_it = models.TextField(blank=True, null=True)
    image_url_en = models.TextField(blank=True, null=True)
    image_url_fr = models.TextField(blank=True, null=True)
    image_url_es = models.TextField(blank=True, null=True)
    sort_order = models.IntegerField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'lesson_types'


class Courses(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    lesson_type = models.ForeignKey(LessonTypes, models.DO_NOTHING, blank=True, null=True)
    teacher = models.ForeignKey(Teachers, models.DO_NOTHING, blank=True, null=True)
    room = models.ForeignKey(SchoolRooms, models.DB_SET_NULL, blank=True, null=True)
    name = models.TextField(blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    frequency = models.TextField()
    start_date = models.DateField(blank=True, null=True)
    end_date = models.DateField(blank=True, null=True)
    start_time = models.TimeField(blank=True, null=True)
    duration_minutes = models.IntegerField()
    max_capacity = models.IntegerField()
    reserve_spots = models.IntegerField()
    credit_cost = models.IntegerField()
    color = models.TextField()
    vip_booking_hours_before = models.IntegerField()
    min_booking_notice_hours = models.IntegerField()
    waitlist_enabled = models.BooleanField()
    active = models.BooleanField()
    created_at = models.DateTimeField(default=timezone.now)
    language = models.TextField()
    country = models.TextField(blank=True, null=True)
    city = models.TextField(blank=True, null=True)
    is_online = models.BooleanField()
    online_link = models.TextField(blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    image_url = models.TextField(blank=True, null=True)
    sort_order = models.IntegerField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'courses'


class CompensationPlans(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    name = models.TextField()
    base_fee = models.DecimalField(max_digits=10, decimal_places=2)
    bonus_threshold = models.IntegerField(blank=True, null=True)
    bonus_per_student = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    bonus_max_threshold = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'compensation_plans'


class CompensationPlanRates(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    plan = models.ForeignKey(CompensationPlans, models.DB_CASCADE)
    lesson_type = models.ForeignKey(LessonTypes, models.DB_CASCADE)
    base_fee = models.DecimalField(max_digits=10, decimal_places=2)
    bonus_per_student = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'compensation_plan_rates'
        unique_together = (('plan', 'lesson_type'),)


class Lessons(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    course = models.ForeignKey(Courses, models.DB_SET_NULL, blank=True, null=True)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    teacher = models.ForeignKey(Teachers, models.DO_NOTHING, blank=True, null=True)
    room = models.ForeignKey(SchoolRooms, models.DB_SET_NULL, blank=True, null=True)
    lesson_type = models.ForeignKey(LessonTypes, models.DO_NOTHING, blank=True, null=True)
    date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    max_capacity = models.IntegerField()
    current_bookings = models.IntegerField()
    status = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)
    is_online = models.BooleanField()
    online_link = models.TextField(blank=True, null=True)
    compensation_plan = models.ForeignKey(CompensationPlans, models.DB_SET_NULL, blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    color = models.TextField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'lessons'


class AttendanceStatuses(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    name = models.TextField()
    color = models.TextField(blank=True, null=True)
    burns_credit = models.BooleanField()
    is_default = models.BooleanField()
    sort_order = models.IntegerField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        managed = False
        db_table = 'attendance_statuses'


class Bookings(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    student = models.ForeignKey(Students, models.DB_CASCADE)
    lesson = models.ForeignKey(Lessons, models.DB_CASCADE)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    access_source = models.TextField()
    student_package = models.ForeignKey('StudentPackages', models.DO_NOTHING, blank=True, null=True)
    student_subscription = models.ForeignKey('StudentSubscriptions', models.DO_NOTHING, blank=True, null=True)
    credits_deducted = models.IntegerField()
    status = models.TextField()
    cancelled_at = models.DateTimeField(blank=True, null=True)
    cancellation_type = models.TextField(blank=True, null=True)
    credit_refunded = models.BooleanField()
    booked_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'bookings'


class Attendance(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    lesson = models.ForeignKey(Lessons, models.DB_CASCADE)
    booking = models.ForeignKey(Bookings, models.DO_NOTHING, blank=True, null=True)
    student = models.ForeignKey(Students, models.DB_CASCADE)
    teacher = models.ForeignKey(Teachers, models.DO_NOTHING, blank=True, null=True)
    status = models.TextField()
    marked_at = models.DateTimeField()
    # Was auto-suffixed `status_0` by inspectdb: clashes with the plain-text
    # `status` column above. This is the FK to the school's custom status list.
    status_type = models.ForeignKey(
        AttendanceStatuses, models.DB_SET_NULL, db_column='status_id', blank=True, null=True,
    )

    class Meta:
        managed = False
        db_table = 'attendance'
        unique_together = (('lesson', 'student'),)


# --- Packages / subscriptions / credits ----------------------------------

class Packages(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    school = models.ForeignKey(Schools, models.DB_CASCADE, blank=True, null=True)
    name_it = models.TextField()
    name_en = models.TextField()
    name_fr = models.TextField()
    name_es = models.TextField()
    description_it = models.TextField(blank=True, null=True)
    description_en = models.TextField(blank=True, null=True)
    credits = models.IntegerField()
    validity_days = models.IntegerField()
    price = models.DecimalField(max_digits=10, decimal_places=2)
    lesson_type_restriction = models.TextField()
    stripe_product_id = models.TextField(blank=True, null=True)
    stripe_price_id = models.TextField(blank=True, null=True)
    color = models.TextField()
    is_popular = models.BooleanField()
    active = models.BooleanField()
    created_at = models.DateTimeField(default=timezone.now)
    is_recurring = models.BooleanField()
    recurring_interval = models.TextField(blank=True, null=True)
    credits_rollover = models.BooleanField()
    language = models.TextField()
    image_url = models.TextField(blank=True, null=True)
    is_vip = models.BooleanField()

    class Meta:
        managed = False
        db_table = 'packages'


class StudentPackages(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    student = models.ForeignKey(Students, models.DB_CASCADE)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    package = models.ForeignKey(Packages, models.DO_NOTHING, blank=True, null=True)
    credits_total = models.IntegerField()
    credits_remaining = models.IntegerField()
    purchased_at = models.DateTimeField()
    expires_at = models.DateTimeField(blank=True, null=True)
    payment_method = models.TextField()
    stripe_payment_id = models.TextField(blank=True, null=True)
    status = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)
    stripe_subscription_id = models.TextField(blank=True, null=True)
    stripe_customer_id = models.TextField(blank=True, null=True)
    next_renewal_at = models.DateTimeField(blank=True, null=True)
    cancelled_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'student_packages'


class SubscriptionsCatalog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    name_it = models.TextField()
    name_en = models.TextField()
    name_fr = models.TextField()
    name_es = models.TextField()
    description_it = models.TextField(blank=True, null=True)
    description_en = models.TextField(blank=True, null=True)
    period_value = models.IntegerField()
    period_unit = models.TextField()
    access_count = models.IntegerField(blank=True, null=True)
    lesson_type_restriction = models.TextField()
    price = models.DecimalField(max_digits=10, decimal_places=2)
    auto_renewal = models.BooleanField()
    is_vip = models.BooleanField()
    priority_booking_hours = models.IntegerField()
    freeze_days_allowed = models.IntegerField()
    stripe_product_id = models.TextField(blank=True, null=True)
    stripe_price_id = models.TextField(blank=True, null=True)
    color = models.TextField()
    active = models.BooleanField()
    created_at = models.DateTimeField(default=timezone.now)
    language = models.TextField()
    image_url = models.TextField(blank=True, null=True)
    is_popular = models.BooleanField()

    class Meta:
        managed = False
        db_table = 'subscriptions_catalog'


class StudentSubscriptions(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    student = models.ForeignKey(Students, models.DB_CASCADE)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    subscription_catalog = models.ForeignKey(SubscriptionsCatalog, models.DO_NOTHING, blank=True, null=True)
    access_total = models.IntegerField(blank=True, null=True)
    access_remaining = models.IntegerField(blank=True, null=True)
    started_at = models.DateTimeField()
    current_period_end = models.DateTimeField(blank=True, null=True)
    grace_period_ends_at = models.DateTimeField(blank=True, null=True)
    stripe_subscription_id = models.TextField(blank=True, null=True)
    status = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        managed = False
        db_table = 'student_subscriptions'


class ManualCreditGrants(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    student = models.ForeignKey(Students, models.DB_CASCADE)
    package = models.ForeignKey(StudentPackages, models.DB_SET_NULL, blank=True, null=True)
    package_name = models.TextField(blank=True, null=True)
    granted_by = models.ForeignKey(Profiles, models.DB_SET_NULL, db_column='granted_by', blank=True, null=True)
    amount = models.IntegerField()
    reason = models.TextField(blank=True, null=True)
    note = models.TextField(blank=True, null=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    payment_method = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        managed = False
        db_table = 'manual_credit_grants'


class DiscountCodes(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    name = models.TextField()
    code = models.TextField()
    type = models.TextField()
    value = models.DecimalField(max_digits=10, decimal_places=2)
    minimum_order = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    valid_for = models.TextField()
    expires_at = models.DateTimeField(blank=True, null=True)
    active = models.BooleanField()
    usage_count = models.IntegerField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        managed = False
        db_table = 'discount_codes'
        unique_together = (('school', 'code'),)


# --- Shop --------------------------------------------------------------

class ShopProducts(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    school = models.ForeignKey(Schools, models.DB_CASCADE, blank=True, null=True)
    name = models.TextField()
    description = models.TextField(blank=True, null=True)
    category = models.TextField()
    price = models.DecimalField(max_digits=10, decimal_places=2)
    images = ArrayField(models.TextField(), blank=True, null=True)
    stripe_product_id = models.TextField(blank=True, null=True)
    active = models.BooleanField()
    created_at = models.DateTimeField(default=timezone.now)
    sizes = ArrayField(
        models.TextField(), blank=True, null=True,
        db_comment='Taglie disponibili (XS..XXL per abbigliamento, 35..41 per scarpe); vuoto = taglia unica',
    )
    original_price = models.DecimalField(
        max_digits=10, decimal_places=2, blank=True, null=True,
        db_comment='Prezzo pieno barrato quando il prodotto è in offerta (price = prezzo scontato)',
    )
    shipping_cost = models.DecimalField(
        max_digits=10, decimal_places=2, blank=True, null=True,
        db_comment='Costo di spedizione del prodotto; 0 = gratis',
    )
    colors = ArrayField(models.TextField(), blank=True, null=True)
    badges = models.JSONField(
        db_comment='Etichette mostrate sulla card e sulla scheda prodotto: array di {label, color}',
    )

    class Meta:
        managed = False
        db_table = 'shop_products'


class ShopProductVariants(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    product = models.ForeignKey(ShopProducts, models.DB_CASCADE)
    size = models.TextField(blank=True, null=True)
    color = models.TextField(blank=True, null=True)
    stock = models.IntegerField()
    sold = models.IntegerField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        managed = False
        db_table = 'shop_product_variants'


class ShopOrders(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    student_id = models.UUIDField()
    school = models.ForeignKey(Schools, models.DO_NOTHING, blank=True, null=True)
    items = models.JSONField()
    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    stripe_payment_id = models.TextField(blank=True, null=True)
    status = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)
    shipping = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        managed = False
        db_table = 'shop_orders'


class ShopSales(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    product = models.ForeignKey(ShopProducts, models.DB_CASCADE)
    variant = models.ForeignKey(ShopProductVariants, models.DB_SET_NULL, blank=True, null=True)
    student = models.ForeignKey(Students, models.DB_SET_NULL, blank=True, null=True)
    qty = models.IntegerField()
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    size = models.TextField(blank=True, null=True)
    color = models.TextField(blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    school = models.ForeignKey(
        Schools, models.DB_SET_NULL, blank=True, null=True,
        db_comment='Scuola dello studente al momento della vendita',
    )
    commission = models.DecimalField(
        max_digits=10, decimal_places=2,
        db_comment='Commissione scuola calcolata automaticamente (total × %)',
    )
    order_id = models.UUIDField(blank=True, null=True)
    shipping = models.DecimalField(max_digits=10, decimal_places=2)
    source = models.TextField()
    payment_method = models.TextField(blank=True, null=True)
    discount = models.DecimalField(max_digits=10, decimal_places=2)
    referrer = models.TextField(blank=True, null=True)
    referrer_percentage = models.DecimalField(max_digits=5, decimal_places=2)
    referrer_commission = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        managed = False
        db_table = 'shop_sales'


# --- Documents -----------------------------------------------------------

class StudentDocuments(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    student = models.ForeignKey(Students, models.DB_CASCADE)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    type = models.TextField()
    file_url = models.TextField(blank=True, null=True)
    uploaded_at = models.DateTimeField()
    expires_at = models.DateTimeField(blank=True, null=True)
    status = models.TextField()
    validated_by = models.ForeignKey(Profiles, models.DO_NOTHING, db_column='validated_by', blank=True, null=True)
    validated_at = models.DateTimeField(blank=True, null=True)
    files = models.JSONField(
        db_comment='Allegati nel bucket privato documents: [{path,name,mime,size}]',
    )
    variant = models.TextField(
        blank=True, null=True,
        db_comment='Variante scelta fra quelle del tipo (es. Passaporto)',
    )
    # Was auto-suffixed `type_0` by inspectdb: clashes with the plain-text
    # `type` column above. This is the FK to the school's structured document types.
    document_type = models.ForeignKey(
        SchoolDocumentTypes, models.DB_SET_NULL, db_column='type_id', blank=True, null=True,
    )
    note = models.TextField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'student_documents'


# --- Communication ---------------------------------------------------------

class Conversations(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    type = models.TextField()
    hq_id = models.UUIDField(blank=True, null=True)
    school = models.ForeignKey(Schools, models.DB_CASCADE, blank=True, null=True)
    student = models.ForeignKey(Students, models.DB_CASCADE, blank=True, null=True)
    status = models.TextField()
    priority = models.TextField()
    assigned_to = models.ForeignKey(Profiles, models.DO_NOTHING, db_column='assigned_to', blank=True, null=True)
    tags = ArrayField(models.TextField(), blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    first_response_at = models.DateTimeField(blank=True, null=True)
    last_message_at = models.DateTimeField(blank=True, null=True)
    teacher = models.ForeignKey(Teachers, models.DB_CASCADE, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'conversations'


class Messages(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    conversation = models.ForeignKey(Conversations, models.DB_CASCADE)
    sender_id = models.UUIDField()
    sender_role = models.TextField()
    content = models.TextField()
    is_internal = models.BooleanField()
    attachment_url = models.TextField(blank=True, null=True)
    read_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        managed = False
        db_table = 'messages'


class QuickReplyTemplates(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    title = models.TextField()
    content = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        managed = False
        db_table = 'quick_reply_templates'


class Notifications(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    user_id = models.UUIDField()
    user_role = models.TextField()
    type = models.TextField()
    title = models.TextField()
    body = models.TextField(blank=True, null=True)
    data = models.JSONField(blank=True, null=True)
    read_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        managed = False
        db_table = 'notifications'


class EmailTemplates(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    school = models.ForeignKey(Schools, models.DB_CASCADE, blank=True, null=True)
    key = models.TextField()
    locale = models.TextField()
    subject = models.TextField()
    body_html = models.TextField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'email_templates'
        unique_together = (('school', 'key', 'locale'), ('key', 'locale'))


class EmailSettings(models.Model):
    key = models.TextField(primary_key=True)
    value = models.TextField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'email_settings'


# --- Financial ---------------------------------------------------------

class Transactions(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    student = models.ForeignKey(Students, models.DO_NOTHING, blank=True, null=True)
    type = models.TextField()
    product_id = models.UUIDField(blank=True, null=True)
    product_name = models.TextField(blank=True, null=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.TextField()
    platform_fee = models.DecimalField(max_digits=10, decimal_places=2)
    school_amount = models.DecimalField(max_digits=10, decimal_places=2)
    payment_method = models.TextField()
    stripe_payment_id = models.TextField(blank=True, null=True)
    status = models.TextField()
    invoice_url = models.TextField(blank=True, null=True)
    referral_school = models.ForeignKey(
        Schools, models.DO_NOTHING, related_name='transactions_referral_school_set', blank=True, null=True,
    )
    referral_commission = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        managed = False
        db_table = 'transactions'


class TeacherCompensationPayments(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    teacher = models.ForeignKey(Teachers, models.DB_CASCADE)
    month = models.TextField()
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.TextField()
    paid_at = models.DateTimeField(blank=True, null=True)
    note = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    payment_method = models.TextField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'teacher_compensation_payments'
        unique_together = (('school', 'teacher', 'month'),)


# --- Library / video -------------------------------------------------------

class LibraryContent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    school = models.ForeignKey(Schools, models.DB_CASCADE, blank=True, null=True)
    lesson_type = models.ForeignKey(LessonTypes, models.DB_SET_NULL, blank=True, null=True)
    title = models.TextField()
    description = models.TextField(blank=True, null=True)
    file_url = models.TextField(blank=True, null=True)
    thumbnail_url = models.TextField(blank=True, null=True)
    type = models.TextField()
    duration_seconds = models.IntegerField(blank=True, null=True)
    level = models.TextField(blank=True, null=True)
    language = models.TextField(blank=True, null=True)
    visible_to_students = models.BooleanField(default=False)
    student_access = models.TextField(blank=True, null=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)
    title_it = models.TextField(blank=True, null=True)
    title_en = models.TextField(blank=True, null=True)
    title_fr = models.TextField(blank=True, null=True)
    title_es = models.TextField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'library_content'


class VideoProgress(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    user_id = models.UUIDField()
    content = models.ForeignKey(LibraryContent, models.DB_CASCADE)
    progress_seconds = models.IntegerField()
    completed = models.BooleanField()
    last_watched_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'video_progress'
        unique_together = (('user_id', 'content'),)


# --- i18n ----------------------------------------------------------------

class Translations(models.Model):
    pk = models.CompositePrimaryKey('key', 'locale')
    key = models.TextField()
    locale = models.TextField()
    value = models.TextField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'translations'
