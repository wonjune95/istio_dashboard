.PHONY: build web go run dev-web docker test vet tidy

# Full build: frontend (embedded by Go) then the binary.
build: web go

web:
	cd web && npm ci && npm run build

go:
	CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/server ./cmd/server

# Local dev: run the API on :8080 (uses local kubeconfig); run `make dev-web`
# in another terminal for the Vite HMR server proxying /api to :8080.
run:
	go run ./cmd/server --dev

dev-web:
	cd web && npm run dev

docker:
	docker build -t istio-dashboard:dev .

test:
	go test ./...

vet:
	go vet ./...

tidy:
	go mod tidy
