# The upstream tilemaker image gives us a pinned, ready-to-run tilemaker
# binary; the remaining tools are installed in the same reproducible builder.
FROM ghcr.io/systemed/tilemaker:master

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gdal-bin \
    nodejs \
    osmium-tool \
    python3 \
    python3-pip \
  && python3 -m pip install --break-system-packages --no-cache-dir \
    rasterio \
    rio-rgbify \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/apps/tile-tools
COPY apps/tile-tools /workspace/apps/tile-tools
COPY data/sources /workspace/data/sources

ENTRYPOINT ["/bin/bash"]
