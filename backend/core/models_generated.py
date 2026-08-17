# This is an auto-generated Django model module.
# You'll have to do the following manually to clean this up:
#   * Rearrange models' order
#   * Make sure each model has one field with primary_key=True
#   * Make sure each ForeignKey and OneToOneField has `on_delete` set to the desired behavior
#   * Remove `managed = False` lines if you wish to allow Django to create, modify, and delete the table
# Feel free to rename the models, but don't rename db_table values or field names.
from django.db import models


class Attendance(models.Model):
    id = models.UUIDField(primary_key=True)
    lesson = models.ForeignKey('Lessons', models.DB_CASCADE)
    booking = models.ForeignKey('Bookings', models.DO_NOTHING, blank=True, null=True)
    student = models.ForeignKey('Students', models.DB_CASCADE)
    teacher = models.ForeignKey('Teachers', models.DO_NOTHING, blank=True, null=True)
    status = models.TextField()
    marked_at = models.DateTimeField()
    status_0 = models.ForeignKey('AttendanceStatuses', models.DB_SET_NULL, db_column='status_id', blank=True, null=True)  # Field renamed because of name conflict.

    class Meta:
        managed = False
        db_table = 'attendance'
        unique_together = (('lesson', 'student'),)


class AttendanceStatuses(models.Model):
    id = models.UUIDField(primary_key=True)
    school = models.ForeignKey('Schools', models.DB_CASCADE)
    name = models.TextField()
    color = models.TextField(blank=True, null=True)
    burns_credit = models.BooleanField()
    is_default = models.BooleanField()
    sort_order = models.IntegerField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'attendance_statuses'


class Bookings(models.Model):
    id = models.UUIDField(primary_key=True)
    student = models.ForeignKey('Students', models.DB_CASCADE)
    lesson = models.ForeignKey('Lessons', models.DB_CASCADE)
    school = models.ForeignKey('Schools', models.DB_CASCADE)
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


class CompensationPlanRates(models.Model):
    id = models.UUIDField(primary_key=True)
    plan = models.ForeignKey('CompensationPlans', models.DB_CASCADE)
    lesson_type = models.ForeignKey('LessonTypes', models.DB_CASCADE)
    base_fee = models.DecimalField(max_digits=10, decimal_places=2)
    bonus_per_student = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'compensation_plan_rates'
        unique_together = (('plan', 'lesson_type'),)


class CompensationPlans(models.Model):
    id = models.UUIDField(primary_key=True)
    school = models.ForeignKey('Schools', models.DB_CASCADE)
    name = models.TextField()
    base_fee = models.DecimalField(max_digits=10, decimal_places=2)
    bonus_threshold = models.IntegerField(blank=True, null=True)
    bonus_per_student = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    created_at = models.DateTimeField()
    bonus_max_threshold = models.DecimalField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'compensation_plans'


class Conversations(models.Model):
    id = models.UUIDField(primary_key=True)
    type = models.TextField()
    hq_id = models.UUIDField(blank=True, null=True)
    school = models.ForeignKey('Schools', models.DB_CASCADE, blank=True, null=True)
    student = models.ForeignKey('Students', models.DB_CASCADE, blank=True, null=True)
    status = models.TextField()
    priority = models.TextField()
    assigned_to = models.ForeignKey('Profiles', models.DO_NOTHING, db_column='assigned_to', blank=True, null=True)
    tags = models.TextField(blank=True, null=True)  # This field type is a guess.
    created_at = models.DateTimeField()
    first_response_at = models.DateTimeField(blank=True, null=True)
    last_message_at = models.DateTimeField(blank=True, null=True)
    teacher = models.ForeignKey('Teachers', models.DB_CASCADE, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'conversations'


class Courses(models.Model):
    id = models.UUIDField(primary_key=True)
    school = models.ForeignKey('Schools', models.DB_CASCADE)
    lesson_type = models.ForeignKey('LessonTypes', models.DO_NOTHING, blank=True, null=True)
    teacher = models.ForeignKey('Teachers', models.DO_NOTHING, blank=True, null=True)
    room = models.ForeignKey('SchoolRooms', models.DB_SET_NULL, blank=True, null=True)
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
    created_at = models.DateTimeField()
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


class DiscountCodes(models.Model):
    id = models.UUIDField(primary_key=True)
    school = models.ForeignKey('Schools', models.DB_CASCADE)
    name = models.TextField()
    code = models.TextField()
    type = models.TextField()
    value = models.DecimalField(max_digits=10, decimal_places=2)
    minimum_order = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    valid_for = models.TextField()
    expires_at = models.DateTimeField(blank=True, null=True)
    active = models.BooleanField()
    usage_count = models.IntegerField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'discount_codes'
        unique_together = (('school', 'code'),)


class EmailSettings(models.Model):
    key = models.TextField(primary_key=True)
    value = models.TextField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'email_settings'


class EmailTemplates(models.Model):
    id = models.UUIDField(primary_key=True)
    school = models.ForeignKey('Schools', models.DB_CASCADE, blank=True, null=True)
    key = models.TextField()
    locale = models.TextField()
    subject = models.TextField()
    body_html = models.TextField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'email_templates'
        unique_together = (('school', 'key', 'locale'), ('key', 'locale'),)


class HqCities(models.Model):
    id = models.UUIDField(primary_key=True)
    country = models.ForeignKey('HqCountries', models.DB_CASCADE)
    name = models.TextField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'hq_cities'


class HqCountries(models.Model):
    id = models.UUIDField(primary_key=True)
    name = models.TextField()
    code = models.TextField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'hq_countries'


class HqMembers(models.Model):
    id = models.OneToOneField('Profiles', models.DB_CASCADE, db_column='id', primary_key=True)
    email = models.TextField()
    name = models.TextField()
    sub_role = models.TextField()
    active = models.BooleanField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'hq_members'


class HqRoles(models.Model):
    key = models.TextField(primary_key=True)
    label = models.TextField()
    builtin = models.BooleanField()
    permissions = models.TextField()  # This field type is a guess.
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'hq_roles'


class LessonTypes(models.Model):
    id = models.UUIDField(primary_key=True)
    code = models.TextField(unique=True)
    name_it = models.TextField()
    name_en = models.TextField()
    name_fr = models.TextField()
    name_es = models.TextField()
    level = models.TextField(blank=True, null=True)
    description_it = models.TextField(blank=True, null=True)
    description_en = models.TextField(blank=True, null=True)
    active = models.BooleanField()
    created_at = models.DateTimeField()
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


class Lessons(models.Model):
    id = models.UUIDField(primary_key=True)
    course = models.ForeignKey(Courses, models.DB_SET_NULL, blank=True, null=True)
    school = models.ForeignKey('Schools', models.DB_CASCADE)
    teacher = models.ForeignKey('Teachers', models.DO_NOTHING, blank=True, null=True)
    room = models.ForeignKey('SchoolRooms', models.DB_SET_NULL, blank=True, null=True)
    lesson_type = models.ForeignKey(LessonTypes, models.DO_NOTHING, blank=True, null=True)
    date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    max_capacity = models.IntegerField()
    current_bookings = models.IntegerField()
    status = models.TextField()
    created_at = models.DateTimeField()
    is_online = models.BooleanField()
    online_link = models.TextField(blank=True, null=True)
    compensation_plan = models.ForeignKey(CompensationPlans, models.DB_SET_NULL, blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    color = models.TextField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'lessons'


class LibraryContent(models.Model):
    id = models.UUIDField(primary_key=True)
    school = models.ForeignKey('Schools', models.DB_CASCADE, blank=True, null=True)
    lesson_type = models.ForeignKey(LessonTypes, models.DB_SET_NULL, blank=True, null=True)
    title = models.TextField()
    description = models.TextField(blank=True, null=True)
    file_url = models.TextField(blank=True, null=True)
    thumbnail_url = models.TextField(blank=True, null=True)
    type = models.TextField()
    duration_seconds = models.IntegerField(blank=True, null=True)
    level = models.TextField(blank=True, null=True)
    language = models.TextField(blank=True, null=True)
    visible_to_students = models.BooleanField()
    student_access = models.TextField(blank=True, null=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    active = models.BooleanField()
    created_at = models.DateTimeField()
    title_it = models.TextField(blank=True, null=True)
    title_en = models.TextField(blank=True, null=True)
    title_fr = models.TextField(blank=True, null=True)
    title_es = models.TextField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'library_content'


class ManualCreditGrants(models.Model):
    id = models.UUIDField(primary_key=True)
    school = models.ForeignKey('Schools', models.DB_CASCADE)
    student = models.ForeignKey('Students', models.DB_CASCADE)
    package = models.ForeignKey('StudentPackages', models.DB_SET_NULL, blank=True, null=True)
    package_name = models.TextField(blank=True, null=True)
    granted_by = models.ForeignKey('Profiles', models.DB_SET_NULL, db_column='granted_by', blank=True, null=True)
    amount = models.IntegerField()
    reason = models.TextField(blank=True, null=True)
    note = models.TextField(blank=True, null=True)
    price = models.DecimalField(blank=True, null=True)
    payment_method = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'manual_credit_grants'


class Messages(models.Model):
    id = models.UUIDField(primary_key=True)
    conversation = models.ForeignKey(Conversations, models.DB_CASCADE)
    sender_id = models.UUIDField()
    sender_role = models.TextField()
    content = models.TextField()
    is_internal = models.BooleanField()
    attachment_url = models.TextField(blank=True, null=True)
    read_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'messages'


class Notifications(models.Model):
    id = models.UUIDField(primary_key=True)
    user_id = models.UUIDField()
    user_role = models.TextField()
    type = models.TextField()
    title = models.TextField()
    body = models.TextField(blank=True, null=True)
    data = models.JSONField(blank=True, null=True)
    read_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'notifications'


class Packages(models.Model):
    id = models.UUIDField(primary_key=True)
    school = models.ForeignKey('Schools', models.DB_CASCADE, blank=True, null=True)
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
    created_at = models.DateTimeField()
    is_recurring = models.BooleanField()
    recurring_interval = models.TextField(blank=True, null=True)
    credits_rollover = models.BooleanField()
    language = models.TextField()
    image_url = models.TextField(blank=True, null=True)
    is_vip = models.BooleanField()

    class Meta:
        managed = False
        db_table = 'packages'


class PendingInvitations(models.Model):
    id = models.UUIDField(primary_key=True)
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


class PlatformSettings(models.Model):
    key = models.TextField(primary_key=True)
    value = models.TextField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'platform_settings'


class Profiles(models.Model):
    id = models.UUIDField(primary_key=True)
    email = models.TextField()
    name = models.TextField()
    role = models.TextField()  # This field type is a guess.
    hq_sub_role = models.TextField(blank=True, null=True)
    school_sub_role = models.TextField(blank=True, null=True)  # This field type is a guess.
    school = models.ForeignKey('Schools', models.DB_SET_NULL, blank=True, null=True)
    language_preference = models.TextField()
    created_at = models.DateTimeField()
    roles = models.TextField(blank=True, null=True)  # This field type is a guess.
    phone = models.TextField(blank=True, null=True)
    city = models.TextField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'profiles'


class QuickReplyTemplates(models.Model):
    id = models.UUIDField(primary_key=True)
    school = models.ForeignKey('Schools', models.DB_CASCADE)
    title = models.TextField()
    content = models.TextField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'quick_reply_templates'


class SchoolClosures(models.Model):
    id = models.UUIDField(primary_key=True)
    school = models.ForeignKey('Schools', models.DB_CASCADE)
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
    id = models.UUIDField(primary_key=True)
    school = models.ForeignKey('Schools', models.DB_CASCADE)
    code = models.TextField()
    name = models.TextField()
    variants = models.TextField()  # This field type is a guess.
    has_expiry = models.BooleanField()
    required = models.BooleanField()
    sort_order = models.IntegerField()
    active = models.BooleanField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'school_document_types'
        unique_together = (('school', 'code'),)


class SchoolLocations(models.Model):
    id = models.UUIDField(primary_key=True)
    school = models.ForeignKey('Schools', models.DB_CASCADE)
    name = models.TextField()
    address = models.TextField(blank=True, null=True)
    google_maps_url = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()
    phone = models.TextField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'school_locations'


class SchoolMemberships(models.Model):
    pk = models.CompositePrimaryKey('profile_id', 'school_id')
    profile = models.ForeignKey(Profiles, models.DB_CASCADE)
    school = models.ForeignKey('Schools', models.DB_CASCADE)
    sub_role = models.TextField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'school_memberships'


class SchoolRooms(models.Model):
    id = models.UUIDField(primary_key=True)
    location = models.ForeignKey(SchoolLocations, models.DB_CASCADE)
    name = models.TextField()
    capacity = models.IntegerField()
    created_at = models.DateTimeField()
    cost = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        managed = False
        db_table = 'school_rooms'


class SchoolStudents(models.Model):
    id = models.UUIDField(primary_key=True)
    school = models.ForeignKey('Schools', models.DB_CASCADE)
    student = models.ForeignKey('Students', models.DB_CASCADE)
    free_lesson_used = models.BooleanField()
    enrolled_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'school_students'
        unique_together = (('school', 'student'), ('school', 'student'),)


class Schools(models.Model):
    id = models.UUIDField(primary_key=True)
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
    created_at = models.DateTimeField()
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
    shop_commission_percentage = models.DecimalField(max_digits=5, decimal_places=2, db_comment='Percentuale riconosciuta alla scuola sulle vendite shop ai suoi studenti')
    show_teacher_to_students = models.BooleanField()
    block_booking_on_documents = models.BooleanField(db_comment='true = niente prenotazione senza documenti obbligatori validi; false = solo avviso')

    class Meta:
        managed = False
        db_table = 'schools'


class ShopOrders(models.Model):
    id = models.UUIDField(primary_key=True)
    student_id = models.UUIDField()
    school = models.ForeignKey(Schools, models.DO_NOTHING, blank=True, null=True)
    items = models.JSONField()
    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    stripe_payment_id = models.TextField(blank=True, null=True)
    status = models.TextField()
    created_at = models.DateTimeField()
    shipping = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        managed = False
        db_table = 'shop_orders'


class ShopProductVariants(models.Model):
    id = models.UUIDField(primary_key=True)
    product = models.ForeignKey('ShopProducts', models.DB_CASCADE)
    size = models.TextField(blank=True, null=True)
    color = models.TextField(blank=True, null=True)
    stock = models.IntegerField()
    sold = models.IntegerField()
    created_at = models.DateTimeField()

    # A unique constraint could not be introspected.
    class Meta:
        managed = False
        db_table = 'shop_product_variants'


class ShopProducts(models.Model):
    id = models.UUIDField(primary_key=True)
    school = models.ForeignKey(Schools, models.DB_CASCADE, blank=True, null=True)
    name = models.TextField()
    description = models.TextField(blank=True, null=True)
    category = models.TextField()
    price = models.DecimalField(max_digits=10, decimal_places=2)
    images = models.TextField(blank=True, null=True)  # This field type is a guess.
    stripe_product_id = models.TextField(blank=True, null=True)
    active = models.BooleanField()
    created_at = models.DateTimeField()
    sizes = models.TextField(blank=True, null=True, db_comment='Taglie disponibili (XS..XXL per abbigliamento, 35..41 per scarpe); vuoto = taglia unica')  # This field type is a guess.
    original_price = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True, db_comment='Prezzo pieno barrato quando il prodotto è in offerta (price = prezzo scontato)')
    shipping_cost = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True, db_comment='Costo di spedizione del prodotto; 0 = gratis')
    colors = models.TextField(blank=True, null=True)  # This field type is a guess.
    badges = models.JSONField(db_comment='Etichette mostrate sulla card e sulla scheda prodotto: array di {label, color}')

    class Meta:
        managed = False
        db_table = 'shop_products'


class ShopSales(models.Model):
    id = models.UUIDField(primary_key=True)
    product = models.ForeignKey(ShopProducts, models.DB_CASCADE)
    variant = models.ForeignKey(ShopProductVariants, models.DB_SET_NULL, blank=True, null=True)
    student = models.ForeignKey('Students', models.DB_SET_NULL, blank=True, null=True)
    qty = models.IntegerField()
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    size = models.TextField(blank=True, null=True)
    color = models.TextField(blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()
    school = models.ForeignKey(Schools, models.DB_SET_NULL, blank=True, null=True, db_comment='Scuola dello studente al momento della vendita')
    commission = models.DecimalField(max_digits=10, decimal_places=2, db_comment='Commissione scuola calcolata automaticamente (total × %)')
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


class StudentDocuments(models.Model):
    id = models.UUIDField(primary_key=True)
    student = models.ForeignKey('Students', models.DB_CASCADE)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    type = models.TextField()
    file_url = models.TextField(blank=True, null=True)
    uploaded_at = models.DateTimeField()
    expires_at = models.DateTimeField(blank=True, null=True)
    status = models.TextField()
    validated_by = models.ForeignKey(Profiles, models.DO_NOTHING, db_column='validated_by', blank=True, null=True)
    validated_at = models.DateTimeField(blank=True, null=True)
    files = models.JSONField(db_comment='Allegati nel bucket privato documents: [{path,name,mime,size}]')
    variant = models.TextField(blank=True, null=True, db_comment='Variante scelta fra quelle del tipo (es. Passaporto)')
    type_0 = models.ForeignKey(SchoolDocumentTypes, models.DB_SET_NULL, db_column='type_id', blank=True, null=True)  # Field renamed because of name conflict.
    note = models.TextField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'student_documents'


class StudentPackages(models.Model):
    id = models.UUIDField(primary_key=True)
    student = models.ForeignKey('Students', models.DB_CASCADE)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    package = models.ForeignKey(Packages, models.DO_NOTHING, blank=True, null=True)
    credits_total = models.IntegerField()
    credits_remaining = models.IntegerField()
    purchased_at = models.DateTimeField()
    expires_at = models.DateTimeField(blank=True, null=True)
    payment_method = models.TextField()
    stripe_payment_id = models.TextField(blank=True, null=True)
    status = models.TextField()
    created_at = models.DateTimeField()
    stripe_subscription_id = models.TextField(blank=True, null=True)
    stripe_customer_id = models.TextField(blank=True, null=True)
    next_renewal_at = models.DateTimeField(blank=True, null=True)
    cancelled_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'student_packages'


class StudentSubscriptions(models.Model):
    id = models.UUIDField(primary_key=True)
    student = models.ForeignKey('Students', models.DB_CASCADE)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    subscription_catalog = models.ForeignKey('SubscriptionsCatalog', models.DO_NOTHING, blank=True, null=True)
    access_total = models.IntegerField(blank=True, null=True)
    access_remaining = models.IntegerField(blank=True, null=True)
    started_at = models.DateTimeField()
    current_period_end = models.DateTimeField(blank=True, null=True)
    grace_period_ends_at = models.DateTimeField(blank=True, null=True)
    stripe_subscription_id = models.TextField(blank=True, null=True)
    status = models.TextField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'student_subscriptions'


class Students(models.Model):
    id = models.UUIDField(primary_key=True)
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
    created_at = models.DateTimeField()
    school = models.ForeignKey(Schools, models.DB_SET_NULL, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'students'


class SubscriptionsCatalog(models.Model):
    id = models.UUIDField(primary_key=True)
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
    created_at = models.DateTimeField()
    language = models.TextField()
    image_url = models.TextField(blank=True, null=True)
    is_popular = models.BooleanField()

    class Meta:
        managed = False
        db_table = 'subscriptions_catalog'


class TeacherCompensationPayments(models.Model):
    id = models.UUIDField(primary_key=True)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    teacher = models.ForeignKey('Teachers', models.DB_CASCADE)
    month = models.TextField()
    amount = models.DecimalField()
    status = models.TextField()
    paid_at = models.DateTimeField(blank=True, null=True)
    note = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()
    payment_method = models.TextField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'teacher_compensation_payments'
        unique_together = (('school', 'teacher', 'month'),)


class TeacherSchools(models.Model):
    pk = models.CompositePrimaryKey('teacher_id', 'school_id')
    teacher = models.ForeignKey('Teachers', models.DB_CASCADE)
    school = models.ForeignKey(Schools, models.DB_CASCADE)
    compensation_plan_id = models.UUIDField(blank=True, null=True)
    active = models.BooleanField()

    class Meta:
        managed = False
        db_table = 'teacher_schools'


class Teachers(models.Model):
    id = models.UUIDField(primary_key=True)
    user_id = models.UUIDField(unique=True, blank=True, null=True)
    name = models.TextField()
    email = models.TextField()
    phone = models.TextField(blank=True, null=True)
    address = models.TextField(blank=True, null=True)
    bio = models.TextField(blank=True, null=True)
    photo_url = models.TextField(blank=True, null=True)
    active = models.BooleanField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'teachers'


class Transactions(models.Model):
    id = models.UUIDField(primary_key=True)
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
    referral_school = models.ForeignKey(Schools, models.DO_NOTHING, related_name='transactions_referral_school_set', blank=True, null=True)
    referral_commission = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'transactions'


class Translations(models.Model):
    pk = models.CompositePrimaryKey('key', 'locale')
    key = models.TextField()
    locale = models.TextField()
    value = models.TextField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'translations'


class VideoProgress(models.Model):
    id = models.UUIDField(primary_key=True)
    user_id = models.UUIDField()
    content = models.ForeignKey(LibraryContent, models.DB_CASCADE)
    progress_seconds = models.IntegerField()
    completed = models.BooleanField()
    last_watched_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'video_progress'
        unique_together = (('user_id', 'content'),)
