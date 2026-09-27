"""Backfill the WhatsApp-sized share variant of special event photos.

New uploads get their `<name>.share.jpg` at once (CourseImageUploadView) and
the public event endpoint builds a missing one on first request, so this is
a warm-up for a deployment that already has photos on the volume — run it
the way `purge_public_media` is run (its workflow's SSM command, with this
command's name; a workflow of its own is not in the repo yet). Idempotent:
existing variants are skipped unless `--force`.
"""

from django.core.management.base import BaseCommand

from catalog.models import Course
from core.share_images import is_public_media_url, make_share_variant, share_variant_for


class Command(BaseCommand):
    help = "Build the share-preview variant (<name>.share.jpg) of every special event photo that lacks one."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Rebuild variants that already exist.")

    def handle(self, *args, **options):
        built = skipped = failed = external = 0
        courses = (
            Course.objects.filter(is_special_event=True).exclude(image_url="")
            .only("id", "name", "image_url").order_by("created_at")
        )
        for course in courses.iterator():
            url = course.image_url
            if not is_public_media_url(url):
                external += 1
                continue
            if not options["force"] and share_variant_for(url) is not None:
                skipped += 1
                continue
            if make_share_variant(url, force=options["force"]) is None:
                failed += 1
                self.stdout.write(f"FAILED  {course.name} ({course.id})  {url}")
            else:
                built += 1
                self.stdout.write(f"BUILT   {course.name} ({course.id})  {url}")
        self.stdout.write(f"built {built}, skipped {skipped}, failed {failed}, external {external}")
