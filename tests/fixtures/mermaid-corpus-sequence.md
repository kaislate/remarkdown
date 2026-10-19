# Sequence corpus (round 2)

Sequence syntax beyond the round-1 subset: actors, activations, blocks, autonumber, boxes, every arrow, create / destroy, titles.

## seq2-login

```mermaid
sequenceDiagram
    title Login
    autonumber
    actor U as User
    participant W as Web app
    participant A as Auth service
    U->>+W: Sign in
    W->>+A: Check password
    alt valid
        A-->>W: Token
    else invalid
        A-->>W: Error
        W-->>U: Try again
    end
    deactivate A
    W-->>-U: Welcome
```

## seq2-nested-blocks

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    %% retries
    loop Up to 3 times
        C->>S: Request
        opt Server busy
            S--)C: Retry later
        end
    end
    break Gave up
        C-xS: Cancel
    end
```

## seq2-par-critical

```mermaid
sequenceDiagram
    participant A
    participant B
    participant C
    par Fan out
        A->>B: Work 1
    and
        A->>C: Work 2
    end
    critical Save
        B->>C: Write
    option Disk full
        B-->C: Fail
    option Timeout
        B--xC: Give up
    end
    rect rgba(0, 128, 255, 0.1)
        C<<->>A: Sync
        C<<-->>A: Sync back
    end
```

## seq2-boxes

```mermaid
sequenceDiagram
    box LightYellow Front end
    participant B as Browser
    participant SW as Service worker
    end
    box Back end
    participant API
    end
    B->>SW: fetch
    SW->>API: miss
    API-->>SW: data
    SW-->>B: cached
```

## seq2-activate-explicit

```mermaid
sequenceDiagram
    participant Q as Queue
    participant W as Worker
    Q->>W: Job
    activate W
    W->>W: Process
    Note right of W: Takes a while
    W-->>Q: Done
    deactivate W
```

## seq2-create-destroy

```mermaid
sequenceDiagram
    participant Alice
    participant Bob
    Alice->>Bob: Start a session
    create participant Carl
    Bob->>Carl: Spawn
    Carl-->>Bob: Ready
    destroy Carl
    Bob-xCarl: Shut down
```

## seq2-frontmatter-comments

```mermaid
---
title: Payment
---
sequenceDiagram
    %% the customer pays
    participant C as Customer
    participant P as Payments # provider
    C->>P: Pay #59; with card
    P-->>C: Receipt
    autonumber off
    C->>P: Thanks
```
