from rest_framework import serializers

from .models import HQCity, HQCountry


class HQCountrySerializer(serializers.ModelSerializer):
    class Meta:
        model = HQCountry
        fields = ("id", "name", "code")


class HQCitySerializer(serializers.ModelSerializer):
    class Meta:
        model = HQCity
        fields = ("id", "country", "name")
