# syntax=docker/dockerfile:1.7

# Build the SolidJS bundle on the host platform — pure JS output, no
# native deps, so we can skip emulation regardless of TARGETPLATFORM.
FROM --platform=$BUILDPLATFORM node:24-alpine AS frontend
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Cross-compile the Go binary for the requested target. $BUILDPLATFORM
# keeps the toolchain native; CGO is disabled so the result is a static
# binary that runs on the distroless base.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS backend
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
COPY --from=frontend /web/dist ./web/dist
ARG TARGETOS TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/rom-manager ./

# Final image: distroless static, nonroot. Mount source/dest dirs and
# a /data dir for the mappings.json on `docker run`.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=backend /out/rom-manager /usr/local/bin/rom-manager
USER nonroot:nonroot
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/rom-manager"]
CMD ["--addr=:8080", "--config=/data/mappings.json"]
