package biz

import "testing"

func TestNormalizeAccessToken(t *testing.T) {
	tests := map[string]struct {
		input string
		want  string
	}{
		"raw token":       {input: "token", want: "token"},
		"bearer token":    {input: "Bearer token", want: "token"},
		"trimmed bearer":  {input: "  Bearer token  ", want: "token"},
		"empty bearer":    {input: "Bearer   ", want: ""},
		"surrounding raw": {input: "  token  ", want: "token"},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			if got := normalizeAccessToken(test.input); got != test.want {
				t.Fatalf("normalizeAccessToken() = %q, want %q", got, test.want)
			}
		})
	}
}
