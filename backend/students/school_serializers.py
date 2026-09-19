from rest_framework import serializers

from .models import ManualCreditGrant, StudentDocument


class CreditGrantSerializer(serializers.ModelSerializer):
    student = serializers.SerializerMethodField()
    granter = serializers.SerializerMethodField()
    # Quante lezioni sono quei crediti: e' la domanda che si fa chi legge
    # l'elenco ("le ho dato 5 lezioni o 20 crediti a caso?"). Null se il
    # pacchetto copre tipi a costi diversi, o se non c'era un pacchetto.
    lessons = serializers.SerializerMethodField()

    class Meta:
        model = ManualCreditGrant
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}, "granted_by": {"required": False}}

    def get_student(self, obj):
        if not obj.student_id:
            return None
        return {
            "name": obj.student.name, "email": obj.student.email,
            "phone": getattr(obj.student, "phone", "") or "",
        }

    def get_lessons(self, obj) -> int | None:
        from catalog.services import lessons_for, package_lesson_cost

        catalog = getattr(getattr(obj, "package", None), "package", None)
        if catalog is None or catalog.is_unlimited:
            return None
        cost = package_lesson_cost(catalog, self.context.get("course_costs") or {})
        if cost is None:
            return None
        lessons = lessons_for(obj.amount, cost)
        # A deduction or reversal (students/credit_movements.py) is told in
        # lessons only when it is a whole number of them, as the usage modal
        # tells it; a grant keeps the whole-lessons reading it always had.
        # "0 lessons" says less than the credits do, for any kind.
        if lessons == 0 or (obj.kind != obj.Kind.GRANT and obj.amount % cost != 0):
            return None
        return lessons

    def get_granter(self, obj):
        if not obj.granted_by_id:
            return None
        user = obj.granted_by
        return {"name": user.full_name or user.email, "email": user.email}


class SchoolDocumentSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.name", read_only=True)

    class Meta:
        model = StudentDocument
        fields = "__all__"
