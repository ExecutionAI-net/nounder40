from django.db import models

from core.models import UUIDTimeStampedModel


class HQCountry(UUIDTimeStampedModel):
    name = models.CharField(max_length=120)
    code = models.CharField(max_length=8)

    class Meta:
        db_table = "hq_countries"
        verbose_name_plural = "HQ countries"

    def __str__(self):
        return f"{self.name} ({self.code})"


class HQCity(UUIDTimeStampedModel):
    country = models.ForeignKey(HQCountry, on_delete=models.CASCADE, related_name="cities")
    name = models.CharField(max_length=120)

    class Meta:
        db_table = "hq_cities"
        verbose_name_plural = "HQ cities"

    def __str__(self):
        return self.name
