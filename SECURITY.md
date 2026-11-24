# Security · Segurança

HireLinks is local-first: there is no server holding anyone's data. Each person runs it on their own computer.
O HireLinks é local: não existe servidor com dados de ninguém. Cada pessoa roda no próprio computador.

## How data is protected · Como os dados ficam protegidos
- HireLinks keeps only settings, the skills you confirmed and the links already delivered. No passwords, no résumé file (it is read once to suggest skills and discarded).
- The local server listens on 127.0.0.1 only, checks the Host header (DNS-rebinding protection) and the Origin, and requires a random per-launch token on every API call.
- Strict Content-Security-Policy, `frame-ancestors 'none'`, `nosniff`, `no-referrer`, no telemetry.
- LinkedIn is read through its public, logged-out pages: your account is never used. Indeed and Glassdoor open in HireLinks' own browser profile; if a site asks you to sign in, you do it yourself in the window.
- Dependabot and CI on every pull request.

## Reporting a vulnerability · Como reportar uma falha
Please do not open a public issue. Use GitHub's "Report a vulnerability" (Security tab) or email rayssarrsilva1@gmail.com.
