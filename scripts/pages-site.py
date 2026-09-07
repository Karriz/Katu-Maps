"""Package and compose Pages sites without executing code from build artifacts."""
import argparse
import json
from pathlib import Path
import shutil
import tarfile


def extract(archive, destination):
    destination = Path(destination)
    with tarfile.open(archive) as source:
        for member in source.getmembers():
            if not (member.isfile() or member.isdir()):
                raise ValueError('Only regular files and directories are allowed')
            target = (destination / member.name).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise ValueError('Archive path escapes destination')
        source.extractall(destination, filter='data')


def compose(production, preview, destination, expected):
    destination = Path(destination)
    if destination.exists():
        raise ValueError('Destination must be new')
    extract(production, destination)
    metadata = json.loads((destination / 'deployment.json').read_text())
    if metadata != json.loads(Path(expected).read_text()):
        raise ValueError('Production archive does not match deployed metadata')
    if not (destination / 'index.html').is_file():
        raise ValueError('Production index missing')
    shutil.rmtree(destination / 'preview', ignore_errors=True)
    shutil.copytree(preview, destination / 'preview')
    if not (destination / 'preview/index.html').is_file():
        raise ValueError('Preview index missing')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('production')
    parser.add_argument('preview')
    parser.add_argument('destination')
    parser.add_argument('metadata')
    args = parser.parse_args()
    compose(args.production, args.preview, args.destination, args.metadata)
