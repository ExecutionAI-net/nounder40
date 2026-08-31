"""The branded card around every email: header and footer are HQ-configurable
(EmailSetting) with the original brand as code default, and relative /media/
image URLs are absolutized so they load in an inbox."""
import pytest
from django.conf import settings

from notifications.emails import to_html_body
from notifications.models import EmailSetting

pytestmark = pytest.mark.django_db


def test_default_frame_is_the_original_brand():
    doc = to_html_body("Ciao")
    assert "No Under 40" in doc
    assert "#6B1F3A" in doc
    assert "© No Under 40 · Classical Dance Network" in doc


def test_custom_header_text_color_and_footer():
    EmailSetting.objects.create(key="email_header_text", value="Danza Classica")
    EmailSetting.objects.create(key="email_header_color", value="#123456")
    EmailSetting.objects.create(key="email_footer_text", value="© Alina Quintana")
    doc = to_html_body("Ciao")
    assert "Danza Classica" in doc and "#123456" in doc and "© Alina Quintana" in doc
    assert "© No Under 40 · Classical Dance Network" not in doc


def test_blank_settings_fall_back_to_the_default():
    for key in ("email_header_text", "email_header_color", "email_footer_text", "email_header_image"):
        EmailSetting.objects.create(key=key, value="  ")
    doc = to_html_body("Ciao")
    assert "No Under 40" in doc and "© No Under 40 · Classical Dance Network" in doc


def test_header_image_replaces_the_text_pill_and_media_urls_are_absolute():
    EmailSetting.objects.create(key="email_header_image", value="/media/public/email-assets/banner.png")
    doc = to_html_body('Testo <img src="/media/public/email-assets/body.png">')
    base = settings.FRONTEND_URL.rstrip("/")
    assert f'src="{base}/media/public/email-assets/banner.png"' in doc
    assert f'src="{base}/media/public/email-assets/body.png"' in doc
    # niente pill di testo quando c'è l'immagine
    assert "display:inline-block;background:" not in doc.split("__CONTENT__")[0]


def test_header_text_is_escaped():
    EmailSetting.objects.create(key="email_header_text", value='<script>x</script>')
    doc = to_html_body("Ciao")
    assert "<script>" not in doc
