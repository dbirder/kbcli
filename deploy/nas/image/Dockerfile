# syntax=docker/dockerfile:1
ARG PYTHON_IMAGE=python:3.13-slim-bookworm@sha256:a1165e272e578941b84abc79e4ab38a0305cd12803a5c4247979ac7655f4d641
FROM ${PYTHON_IMAGE}
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOME=/opt/data/home TZ=Asia/Shanghai
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10000 kbcli \
    && useradd --uid 10000 --gid 10000 --home-dir /opt/data --no-create-home kbcli \
    && mkdir -p /opt/app /opt/data/home && chown -R 10000:10000 /opt/data
WORKDIR /opt/app
COPY requirements.txt /opt/app/requirements.txt
RUN python -m pip install --no-cache-dir --require-hashes -r requirements.txt
COPY kbcli-*.whl /opt/app/
RUN python -m pip install --no-cache-dir --no-deps /opt/app/kbcli-*.whl && rm /opt/app/*.whl
COPY nas_autosync.py healthcheck.py /opt/app/
USER 10000:10000
EXPOSE 8765
ENTRYPOINT ["/usr/local/bin/python"]
CMD ["-m","kbcli","--vault","/opt/data/knowledge-base","--state-dir","/opt/data/kbcli/state","serve","--host","0.0.0.0","--port","8765"]
