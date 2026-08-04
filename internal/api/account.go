package api

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"golang.org/x/crypto/bcrypt"
)

// InitialAdminSecret은 ArgoCD의 argocd-initial-admin-secret과 같은 역할:
// 자동 생성된 admin 초기 비밀번호(평문)를 담는다. 비밀번호 변경 후 지워도 된다.
const InitialAdminSecret = "istio-dashboard-initial-admin-secret"

// EnsureInitialAdmin은 계정 ConfigMap에 admin이 없으면(또는 CM 자체가 없으면)
// 랜덤 초기 비밀번호를 생성해 해시는 CM에, 평문은 Secret에 저장한다.
// 부팅을 막을 일은 아니므로 실패는 경고 로그로만 남긴다.
func (s *Server) EnsureInitialAdmin(ctx context.Context) {
	if s.dev || s.accountsCM.Name == "" {
		return
	}
	client, err := s.factory.Base()
	if err != nil {
		slog.Warn("initial admin: k8s client unavailable", "err", err)
		return
	}
	cms := client.Kube.CoreV1().ConfigMaps(s.accountsCM.Namespace)
	cm, err := cms.Get(ctx, s.accountsCM.Name, metav1.GetOptions{})
	cmMissing := apierrors.IsNotFound(err)
	switch {
	case err == nil && cm.Data["admin"] != "":
		return // admin 존재 — 할 일 없음
	case err != nil && !cmMissing:
		slog.Warn("initial admin: read accounts configmap failed", "err", err)
		return
	}

	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		slog.Warn("initial admin: entropy unavailable", "err", err)
		return
	}
	pw := base64.RawURLEncoding.EncodeToString(raw)
	hash, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		slog.Warn("initial admin: hash failed", "err", err)
		return
	}
	entry := "admin:" + string(hash)
	if cmMissing {
		_, err = cms.Create(ctx, &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{Name: s.accountsCM.Name, Namespace: s.accountsCM.Namespace},
			Data:       map[string]string{"admin": entry},
		}, metav1.CreateOptions{})
	} else {
		err = s.patchAccount(ctx, "admin", entry)
	}
	if err != nil {
		slog.Warn("initial admin: write accounts configmap failed", "err", err)
		return
	}

	secrets := client.Kube.CoreV1().Secrets(s.accountsCM.Namespace)
	sec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: InitialAdminSecret, Namespace: s.accountsCM.Namespace},
		StringData: map[string]string{"password": pw},
	}
	if _, err := secrets.Create(ctx, sec, metav1.CreateOptions{}); apierrors.IsAlreadyExists(err) {
		_, err = secrets.Update(ctx, sec, metav1.UpdateOptions{})
		if err != nil {
			slog.Warn("initial admin: update secret failed", "err", err)
			return
		}
	} else if err != nil {
		slog.Warn("initial admin: create secret failed", "err", err)
		return
	}
	slog.Info("initial admin password generated", "secret", s.accountsCM.Namespace+"/"+InitialAdminSecret)
}

// AccountsCMRef locates the accounts ConfigMap so password changes can be
// written back (the mounted dir is read-only from the pod's perspective).
type AccountsCMRef struct{ Namespace, Name string }

// handlePasswordChange lets any logged-in user (viewer 포함) change their own
// password: verify the current one, bcrypt the new one, patch the ConfigMap key.
// The mounted dir syncs within ~1min, so the old password works until then.
func (s *Server) handlePasswordChange(w http.ResponseWriter, r *http.Request) {
	if s.dev {
		writeError(w, http.StatusBadRequest, "BadRequest", "dev 모드에는 계정이 없습니다")
		return
	}
	id, err := s.sessionIdentity(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Unauthorized", err.Error())
		return
	}
	var in struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "BadRequest", "잘못된 요청 형식입니다")
		return
	}
	if len(in.NewPassword) < 8 {
		writeError(w, http.StatusBadRequest, "BadRequest", "새 비밀번호는 8자 이상이어야 합니다")
		return
	}
	role, err := s.accounts.Authenticate(id.Name, in.CurrentPassword)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Unauthorized", "현재 비밀번호가 일치하지 않습니다")
		return
	}
	if s.accountsCM.Name == "" {
		writeError(w, http.StatusInternalServerError, "Internal", "계정 ConfigMap 위치가 설정되지 않았습니다 (ACCOUNTS_CONFIGMAP/POD_NAMESPACE)")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal", err.Error())
		return
	}
	if err := s.patchAccount(r.Context(), id.Name, role+":"+string(hash)); err != nil {
		writeError(w, http.StatusInternalServerError, "Internal", "계정 ConfigMap 갱신 실패: "+err.Error())
		return
	}
	slog.Info("password changed", "user", id.Name)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) patchAccount(ctx context.Context, user, entry string) error {
	client, err := s.factory.Base()
	if err != nil {
		return err
	}
	b, err := json.Marshal(map[string]any{"data": map[string]string{user: entry}})
	if err != nil {
		return err
	}
	_, err = client.Kube.CoreV1().ConfigMaps(s.accountsCM.Namespace).
		Patch(ctx, s.accountsCM.Name, types.MergePatchType, b, metav1.PatchOptions{})
	if err != nil {
		return fmt.Errorf("%s/%s: %w", s.accountsCM.Namespace, s.accountsCM.Name, err)
	}
	return nil
}
