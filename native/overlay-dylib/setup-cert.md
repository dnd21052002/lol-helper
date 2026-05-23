# Setup self-signed code-signing certificate

The injector binary needs `com.apple.security.cs.debugger` entitlement to
call `task_for_pid` on another process. Apple requires a real (not ad-hoc)
code-signing identity for that entitlement to take effect on macOS with SIP
enabled.

Do this once per machine.

## Steps

1. Open **Keychain Access** (`/System/Applications/Utilities/Keychain Access.app`).

2. Menu bar: **Keychain Access → Certificate Assistant → Create a Certificate…**

3. Fill in:
   - **Name**: `lol-injector-cert`
   - **Identity Type**: `Self Signed Root`
   - **Certificate Type**: `Code Signing`
   - Check **Let me override defaults**
   - Click **Continue**

4. Defaults are fine through the wizard. Click **Continue** until **Create**.

5. After the cert appears in the **login** keychain:
   - Double-click the cert → expand **Trust** section
   - Set **When using this certificate** to **Always Trust**
   - Close the window (Touch ID / password prompt)

6. Verify from terminal:

   ```bash
   security find-identity -v -p codesigning | grep lol-injector-cert
   ```

   Should show one valid identity ending with `"lol-injector-cert"`.

## Sign the injector

```bash
cd native/overlay-dylib
make           # builds everything
make sign      # codesigns build/lol-injector with the cert + entitlements
```

The `sign` target runs:

```bash
codesign --force --options runtime \
         --entitlements entitlements.plist \
         --sign lol-injector-cert \
         build/lol-injector
```

## First run — grant Developer Tools access

The first time `lol-injector` calls `task_for_pid`, macOS may prompt:

> "Terminal" wants permission to take control of system events.

Or it may silently fail with `(os/kern) failure (0x5)` (KERN_FAILURE).
If that happens:

1. **System Settings → Privacy & Security → Developer Tools**
2. Add `Terminal.app` (or your shell of choice — iTerm, Warp, etc.) to the list
3. Restart the terminal

If the prompt for **Developer Tools** never appears, run:

```bash
sudo DevToolsSecurity -enable
```

## Verify the signature took effect

```bash
codesign -d --entitlements - build/lol-injector 2>&1 | grep debugger
```

Should output:

```
[Key] com.apple.security.cs.debugger
[Value]
    [Bool] true
```

If it doesn't, signing failed silently — re-run `make sign` and check stderr.

## Troubleshooting

- **`task_for_pid: (os/kern) failure (0x5)`** — entitlement not granted by the
  kernel. Most common causes:
  - Cert is ad-hoc (`-` instead of a real cert) — macOS 26 ignores
    `cs.debugger` on ad-hoc signed binaries
  - Cert is not trusted for code signing — re-do step 5
  - Terminal lacks Developer Tools privilege — see above

- **`task_for_pid: (os/kern) invalid argument (0x4)`** — target PID is dead
  or in a different security domain (e.g. SIP-protected binary). LeagueClient
  and LeagueofLegends are unsigned for hardened runtime so this should not
  happen for them.

- **Signature gets stripped on rebuild** — `make sign` runs after `make`. If
  you rebuild without re-signing, the entitlement is gone. Re-run
  `make sign` after every `make`.
