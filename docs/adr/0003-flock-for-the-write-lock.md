# ADR003 - flock(1) for the write service's advisory lock
* Date: Oct 26, 2026
* Status: ADOPTED
* Author: bfarkas (drafted with Claude Code)

## Decision
The Git write service takes its cross-process lock on
`repo/.git/octosprout.lock` by running `flock(1)` as a helper process that
holds the lock while its stdin stays open. In-process writes are serialized by
a FIFO queue in front of it.

## Context
Spec §8.2 asks for an OS-level advisory lock (`flock`) to guard against an
accidental second process, such as an admin running the CLI in the container.
Node.js has no built-in binding for flock(2).

## Options Considered
### Option 1 (SELECTED): flock(1) helper process
#### Consequences
 * Adopted because: it is a real kernel lock; if the server dies, the pipe closes, the helper exits and the lock is released, so there are no stale lock files.
 * Adopted because: it supports a timeout (`-w`) and a distinct exit code for "held by someone else".
 * Adopted despite: it needs `flock` from util-linux. The Docker image (Debian) has it; macOS does not by default, which matters only if the write service ever runs on a Mac.

### Option 2: A lock file created with O_EXCL plus stale-PID detection
#### Consequences
 * Rejected because: taking over a stale lock races with a process that has just created a new one.
 * Rejected despite: no external tool.

### Option 3: A native addon for flock(2)
#### Consequences
 * Rejected because: a compiled dependency in the image and in CI for one system call.

## Advice
 * None recorded.

## Supporting Material
 * [app/packages/server/src/git/lock.ts](../../app/packages/server/src/git/lock.ts)
