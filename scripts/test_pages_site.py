import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('pages_site', Path(__file__).with_name('pages-site.py'))
site = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site)

class PagesSiteTests(unittest.TestCase):
    def test_preserves_production_bytes_and_replaces_preview(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            production = root / 'production'
            production.mkdir()
            (production / 'index.html').write_bytes(b'production\x00bytes')
            (production / 'deployment.json').write_text(json.dumps({'tag': 'v1.0.0'}))
            (production / 'preview').mkdir()
            (production / 'preview/old.txt').write_text('old')
            archive = root / 'production.tar.gz'
            with tarfile.open(archive, 'w:gz') as output:
                output.add(production, arcname='.')
            preview = root / 'new'
            preview.mkdir()
            (preview / 'index.html').write_text('preview')
            site.compose(archive, preview, root / 'site', production / 'deployment.json')
            self.assertEqual((root / 'site/index.html').read_bytes(), b'production\x00bytes')
            self.assertEqual((root / 'site/preview/index.html').read_text(), 'preview')
            self.assertFalse((root / 'site/preview/old.txt').exists())
            (production / 'deployment.json').write_text('{}')
            with self.assertRaises(ValueError):
                site.compose(archive, preview, root / 'mismatch', production / 'deployment.json')

    def test_rejects_paths_and_links(self):
        for name, kind in [('../escape', tarfile.REGTYPE), ('link', tarfile.SYMTYPE)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                archive = Path(directory) / 'bad.tar.gz'
                with tarfile.open(archive, 'w:gz') as output:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    member.linkname = '/etc/passwd' if kind == tarfile.SYMTYPE else ''
                    output.addfile(member, io.BytesIO())
                with self.assertRaises(ValueError):
                    site.extract(archive, Path(directory) / 'out')

if __name__ == '__main__':
    unittest.main()
