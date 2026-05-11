const fs = require('fs');
const path = require('path');

describe('VerifyEmail manual confirmation flow', () => {
  const componentPath = path.join(__dirname, '../components/pages/VerifyEmail.jsx');
  const source = fs.readFileSync(componentPath, 'utf8');
  const authContextPath = path.join(__dirname, '../contexts/AuthContext.jsx');
  const authContextSource = fs.readFileSync(authContextPath, 'utf8');

  test('does not auto-verify on page load', () => {
    expect(source).not.toMatch(/useEffect\s*\(/);
    expect(source).not.toContain("axios.get('/api/auth/verify-email'");
  });

  test('only verifies through explicit POST submission', () => {
    expect(source).toContain("axios.post('/api/auth/verify-email'");
    expect(source).toContain("t('verifyEmail.actions.verify')");
    expect(source).toContain('disabled={isSubmitting}');
  });

  test('locks verification to one request per token per page load', () => {
    expect(source).toContain('const attemptedTokenRef = useRef(null);');
    expect(source).toContain("if (!token || isSubmitting || attemptedTokenRef.current === token) return;");
    expect(source).toContain('attemptedTokenRef.current = token;');
    expect(source).toContain('const activeVerificationRequestIdRef = useRef(0);');
    expect(source).toContain("if (activeVerificationRequestIdRef.current !== requestId) return;");
    expect(source).toContain("{token && status === 'idle' && (");
  });

  test('refreshes global auth state after successful verification', () => {
    expect(source).toContain('await refreshUser()');
    expect(authContextSource).toContain('const refreshUser = useCallback(async () => {');
    expect(authContextSource).toContain("axios.get('/api/auth/me')");
    expect(authContextSource).toContain('refreshUser,');
  });

  test('supports expired-link recovery without requiring authenticated state', () => {
    expect(source).toContain("const [isResending, setIsResending] = useState(false);");
    expect(source).toContain("const result = await resendVerificationEmail(token ? { token } : undefined);");
    expect(source).toContain("{status === 'expired' && (");
    expect(source).not.toContain("{status === 'expired' && isAuthenticated && (");
    expect(source).toContain('disabled={isResending}');
    expect(authContextSource).toContain('const resendVerificationEmail = async (options = {}) => {');
    expect(authContextSource).toContain('if (options.token) {');
    expect(authContextSource).toContain("axios.post('/api/auth/resend-verification', payload)");
  });

  test('maps backend verification states to explicit UI messages', () => {
    expect(source).toContain("case 'verified':");
    expect(source).toContain("case 'already_verified':");
    expect(source).toContain("case 'expired':");
    expect(source).toContain("case 'invalid':");
    expect(source).toContain("return 'verifyEmail.messages.expired';");
    expect(source).toContain("return hasToken ? 'verifyEmail.messages.invalid' : 'verifyEmail.messages.missingToken';");
  });

  test('shows resend CTA only for expired verification links', () => {
    expect(source).toContain("{status === 'expired' && (");
  });
});
