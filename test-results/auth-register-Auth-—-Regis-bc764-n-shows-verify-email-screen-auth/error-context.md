# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth\register.spec.ts >> Auth — Register flow >> successful registration shows verify email screen
- Location: tests\e2e\auth\register.spec.ts:94:7

# Error details

```
Error: ENOENT: no such file or directory, open 'C:\Users\hakan\Desktop\backup\no_under_40\test-results\.playwright-artifacts-3\traces\7a2e1e1ccab58a85dc6a-bcbb1641335a3494b1aa-recording59.stacks'
```

```
Error: apiRequestContext._wrapApiCall: ENOENT: no such file or directory, open 'C:\Users\hakan\Desktop\backup\no_under_40\test-results\.playwright-artifacts-3\traces\7a2e1e1ccab58a85dc6a-bcbb1641335a3494b1aa-recording59.trace'
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - img [ref=e5]
    - generic [ref=e7]:
      - heading "Verify your email" [level=2] [ref=e8]
      - paragraph [ref=e9]: We sent a confirmation link to e2e-register-1777007212782@test.local. Click the link to activate your account.
    - link "Back to login" [ref=e10] [cursor=pointer]:
      - /url: /en/login
  - button "Open Next.js Dev Tools" [ref=e16] [cursor=pointer]:
    - img [ref=e17]
  - alert [ref=e20]
```