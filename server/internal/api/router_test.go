package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealth(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	NewRouter(newTestService(t), newTestTaskService(t, fakeEngine(t, false).URL)).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body healthResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body.Status != "ok" {
		t.Fatalf("status field = %q, want ok", body.Status)
	}
	if body.Version == "" {
		t.Fatal("version 涓虹┖")
	}
}

func TestVersion(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/version", nil)
	rec := httptest.NewRecorder()
	NewRouter(newTestService(t), newTestTaskService(t, fakeEngine(t, false).URL)).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body["version"] != version {
		t.Fatalf("version = %q, want %q", body["version"], version)
	}
}

func TestUnknownRoute404(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/nope", nil)
	rec := httptest.NewRecorder()
	NewRouter(newTestService(t), newTestTaskService(t, fakeEngine(t, false).URL)).ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/health", nil)
	rec := httptest.NewRecorder()
	NewRouter(newTestService(t), newTestTaskService(t, fakeEngine(t, false).URL)).ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
}
