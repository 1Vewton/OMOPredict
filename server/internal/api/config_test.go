package api

import "testing"

func TestParseAuthMode(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in      string
		want    AuthMode
		wantErr bool
	}{
		{"", AuthModeJWT, false},        // 缺省 = jwt（向后兼容）
		{"jwt", AuthModeJWT, false},     //
		{"JWT", AuthModeJWT, false},     // 大小写不敏感
		{" none ", AuthModeNone, false}, // 允许空白
		{"NONE", AuthModeNone, false},   //
		{"bogus", "", true},             // 非法值报错
	}
	for _, c := range cases {
		got, err := ParseAuthMode(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("ParseAuthMode(%q) 期望报错，得到 %q", c.in, got)
			}
			continue
		}
		if err != nil || got != c.want {
			t.Errorf("ParseAuthMode(%q) = (%q, %v), want (%q, nil)", c.in, got, err, c.want)
		}
	}
}

func TestParseEngineTransport(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"", EngineTransportHTTP, false},
		{"http", EngineTransportHTTP, false},
		{"StDio", EngineTransportStdio, false},
		{"pipe", "", true},
	}
	for _, c := range cases {
		got, err := ParseEngineTransport(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("ParseEngineTransport(%q) 期望报错，得到 %q", c.in, got)
			}
			continue
		}
		if err != nil || got != c.want {
			t.Errorf("ParseEngineTransport(%q) = (%q, %v), want (%q, nil)", c.in, got, err, c.want)
		}
	}
}

func TestConfigDefaults(t *testing.T) {
	t.Parallel()
	// 零值 = Web 默认（jwt + http + 需要认证）
	web := Config{}
	if web.authMode() != AuthModeJWT {
		t.Fatalf("零值 authMode = %q, want jwt", web.authMode())
	}
	if web.engineTransport() != EngineTransportHTTP {
		t.Fatalf("零值 engineTransport = %q, want http", web.engineTransport())
	}
	if !web.authRequired() {
		t.Fatal("零值应要求认证")
	}
	if web.version() != version {
		t.Fatalf("零值 version = %q, want 包级 %q", web.version(), version)
	}

	// 桌面本地模式
	local := Config{
		AuthMode:        AuthModeNone,
		EngineTransport: EngineTransportStdio,
		Version:         "9.9.9-test",
	}
	if local.authRequired() {
		t.Fatal("none 模式不应要求认证")
	}
	if local.version() != "9.9.9-test" {
		t.Fatalf("version 覆盖失效: %q", local.version())
	}
	if local.engineTransport() != EngineTransportStdio {
		t.Fatalf("engineTransport = %q, want stdio", local.engineTransport())
	}
}
