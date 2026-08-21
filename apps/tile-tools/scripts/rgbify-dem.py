#!/usr/bin/env python3
"""Create Terrain-RGB MBTiles with a Rasterio compatibility fix.

rio-rgbify 0.4.0 passes densify_pts=0 to newer Rasterio versions, which now
rejects that value when transforming bounds to geographic coordinates.
"""

import argparse

import rasterio
from rasterio.warp import transform_bounds as rasterio_transform_bounds
from rasterio._io import virtual_file_to_buffer
import rio_rgbify.mbtiler as mbtiler


def transform_bounds_compatible(*args, **kwargs):
    if kwargs.get("densify_pts") == 0:
        kwargs["densify_pts"] = 2
    return rasterio_transform_bounds(*args, **kwargs)


mbtiler.transform_bounds = transform_bounds_compatible


def encode_as_png_compatible(data, profile, dst_transform):
    """Write a tile with Rasterio's current transform metadata key."""
    profile = profile.copy()
    profile["transform"] = dst_transform
    profile.pop("affine", None)
    with rasterio.open("/vsimem/tileimg", "w", **profile) as dataset:
        dataset.write(data)
    return bytearray(virtual_file_to_buffer("/vsimem/tileimg"))


mbtiler._encode_as_png = encode_as_png_compatible


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--min-z", type=int, required=True)
    parser.add_argument("--max-z", type=int, required=True)
    parser.add_argument("--base-val", type=float, default=-10000)
    parser.add_argument("--interval", type=float, default=0.1)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()

    with mbtiler.RGBTiler(
        args.input,
        args.output,
        min_z=args.min_z,
        max_z=args.max_z,
        base_val=args.base_val,
        interval=args.interval,
        format="png",
    ) as tiler:
        tiler.run(args.workers)


if __name__ == "__main__":
    main()
