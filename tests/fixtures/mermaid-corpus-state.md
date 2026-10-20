# State diagram corpus

Realistic state diagrams for the state parser / edit engine / SVG
mapping tests. Format: `## heading` then a mermaid fence.

## state-v1-basic

```mermaid
stateDiagram
    [*] --> Still
    Still --> [*]
    Still --> Moving
    Moving --> Still
    Moving --> Crash
    Crash --> [*]
```

## state-descriptions

```mermaid
stateDiagram-v2
    state "Waiting for payment" as Waiting
    Waiting : Customer has 15 minutes
    [*] --> Waiting
    Waiting --> Paid : payment received
    Waiting --> Cancelled : timeout
    Paid : Thank you!
    Paid --> [*]
    Cancelled --> [*]
```

## state-composite-nested

```mermaid
stateDiagram-v2
    direction LR
    [*] --> First
    state First {
        [*] --> Second
        state Second {
            [*] --> second
            second --> Third
            state Third {
                [*] --> third
                third --> [*]
            }
        }
    }
    First --> Done
```

## state-concurrency

```mermaid
stateDiagram-v2
    [*] --> Active
    state Active {
        [*] --> NumLockOff
        NumLockOff --> NumLockOn : EvNumLockPressed
        NumLockOn --> NumLockOff : EvNumLockPressed
        --
        [*] --> CapsLockOff
        CapsLockOff --> CapsLockOn : EvCapsLockPressed
        CapsLockOn --> CapsLockOff : EvCapsLockPressed
    }
    Active --> [*]
```

## state-choice

```mermaid
stateDiagram-v2
    state if_state <<choice>>
    [*] --> IsPositive
    IsPositive --> if_state
    if_state --> False : if n < 0
    if_state --> True : if n >= 0
```

## state-fork-join

```mermaid
stateDiagram-v2
    state fork_state <<fork>>
    [*] --> fork_state
    fork_state --> State2
    fork_state --> State3

    state join_state <<join>>
    State2 --> join_state
    State3 --> join_state
    join_state --> State4
    State4 --> [*]
```

## state-notes

```mermaid
stateDiagram-v2
    State1 : The state with a note
    note right of State1
        Important information! You can write
        notes.
    end note
    State1 --> State2
    note left of State2 : This is the note to the left.
```

## state-comments-init

```mermaid
%%{init: {"theme": "forest"}}%%
stateDiagram-v2
    %% The order lifecycle
    [*] --> Draft
    Draft --> Review : submit
    %% reviewers may bounce it back
    Review --> Draft : changes requested
    Review --> Published : approve

    Published --> [*]
```

## state-frontmatter-title

```mermaid
---
title: Traffic light
---
stateDiagram-v2
    [*] --> Red
    Red --> Green : timer
    Green --> Yellow : timer
    Yellow --> Red : timer
```

## state-styling

```mermaid
stateDiagram-v2
    classDef badBadEvent fill:#f00,color:white,font-weight:bold,stroke-width:2px,stroke:yellow
    classDef movement font-style:italic
    [*] --> Still
    Still --> [*]
    Still --> Moving:::movement
    Moving --> Still
    Moving --> Crash
    Crash --> [*]
    class Crash badBadEvent
```

## state-v1-composite-notes

```mermaid
stateDiagram
    [*] --> Idle
    Idle --> Processing : job arrives
    state Processing {
        [*] --> Parsing
        Parsing --> Rendering
        Rendering --> [*]
    }
    Processing --> Idle : done
    note left of Idle : nothing to do
```

## state-composite-label-direction

```mermaid
stateDiagram-v2
    hide empty description
    state "Checkout flow" as Checkout {
        direction LR
        Cart --> Address
        Address --> Payment
    }
    [*] --> Checkout
    Checkout --> [*]
```

## state-entity-codes

```mermaid
stateDiagram-v2
    state "Price #gt; #36;100" as Big
    Small : Under #36;10
    [*] --> Small
    Small --> Big : grows #amp; scales
```

## state-duplicate-transitions

```mermaid
stateDiagram-v2
    A --> B : once
    A --> B : twice
    B --> A
```

## state-choice-in-composite

```mermaid
stateDiagram-v2
    [*] --> Machine
    state Machine {
        [*] --> Ready
        state check <<choice>>
        Ready --> check
        check --> Ready : retry
        check --> [*] : ok
        note right of Ready : inside a composite
    }
    Machine --> [*]
```

## state-compact-syntax

```mermaid
stateDiagram-v2
    accTitle: Door states
    accDescr: A door that opens and closes
    [*]-->Closed
    Closed-->Open:open
    Open-->Closed:close
    Closed-->[*]
```
