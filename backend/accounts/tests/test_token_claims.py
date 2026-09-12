"""R4-L16 (QA_REGRESSION_ROUND4 cross-cutting note): register, complete-invite
and password-reset-confirm minted tokens with only `user_id`, while login
added `role`/`roles`. One factory, one shape."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import AccessToken

from accounts.views import _tokens_for

pytestmark = pytest.mark.django_db


def test_the_shared_token_factory_carries_the_role_claims():
    user = get_user_model().objects.create(
        email=f"u-{uuid.uuid4().hex[:8]}@example.com", role="student", roles=["student"]
    )
    tokens = _tokens_for(user)
    claims = AccessToken(tokens["access"])
    assert claims["role"] == "student"
    assert claims["roles"] == ["student"]
    assert claims["user_id"] == str(user.pk)
