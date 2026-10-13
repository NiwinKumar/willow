"""Google Cloud clients. Application Default Credentials everywhere; no key files."""

from functools import lru_cache

import google.auth
from google.auth import impersonated_credentials
from google.cloud import firestore, storage

from app.settings import get_settings

_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]


@lru_cache
def signing_credentials():
    """Credentials that can sign V4 URLs via IAM signBlob as the api service account.

    Works identically on Cloud Run (sa-api impersonating itself; it holds
    roles/iam.serviceAccountTokenCreator on itself) and locally (your user impersonating sa-api).
    """
    source, _ = google.auth.default(scopes=_SCOPES)
    return impersonated_credentials.Credentials(
        source_credentials=source,
        target_principal=get_settings().signing_service_account,
        target_scopes=_SCOPES,
        lifetime=3600,
    )


@lru_cache
def storage_client() -> storage.Client:
    return storage.Client(project=get_settings().project_id, credentials=signing_credentials())


@lru_cache
def firestore_client() -> firestore.Client:
    return firestore.Client(project=get_settings().project_id)
