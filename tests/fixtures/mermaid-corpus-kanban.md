# Kanban corpus

Extra kanban examples for the kanban parser / edit engine tests
(tests/unit/editor/mermaid-kanban-*.test.ts). Same format as
mermaid-corpus.md: `## heading` then a mermaid fence.

## kb-docs-example

```mermaid
kanban
  Todo
    [Create Documentation]
    docs[Create Blog about the new diagram]
  [In progress]
    id6[Create renderer so that it works in all cases. We also add some extra text here for testing purposes. And some more just for the extra flare.]
  id9[Ready for deploy]
    id8[Design grammar]@{ assigned: 'knsv' }
  id10[Ready for test]
    id4[Create parsing tests]@{ ticket: MC-2038, assigned: 'K.Sveidqvist', priority: 'High' }
    id66[last item]@{ priority: 'Very Low', assigned: 'knsv' }
  id11[Done]
    id5[define getData]
    id2[Title of diagram is more than 100 chars when user duplicates diagram with 100 char]@{ ticket: MC-2036, priority: 'Very High'}
    id3[Update DB function]@{ ticket: MC-2037, assigned: knsv, priority: 'High' }
```

## kb-block-metadata

```mermaid
kanban
  backlog[Backlog]
    t1[Plan the sprint]@{
      assigned: "Maria"
      ticket: SPR-1
      priority: 'Low'
    }
    t2[Fix the login bug]@{ priority: "Very High" }
  active[Active]
    t3[Write the release notes]
```

## kb-bare-cards

```mermaid
kanban
  Ideas
    Paint the fence
    Fix the gate
  Errands
    Buy milk
```

## kb-comments-init

```mermaid
%%{init: {"theme": "forest"}}%%
kanban
  %% the board
  todo[To do]
    a[Draft]

    %% blank line above
    b[Review]
  done[Done]
    %% nothing here yet
```

## kb-frontmatter

```mermaid
---
title: Team board
config:
  kanban:
    ticketBaseUrl: 'https://tracker.example.com/browse/#TICKET#'
---
kanban
  col1[Open]
    c1[Investigate crash]@{ ticket: 42, assigned: "Sam" }
  col2[Closed]
    c2[Old task]@{ ticket: OPS-7 }
```

## kb-tabs

```mermaid
kanban
	Todo
		[Tabbed card]
		[Second card]
	Done
		[Finished]
```

## kb-icons-classes

```mermaid
kanban
  todo[Todo]
    a[Read the book]
    ::icon(fa fa-book)
    b[Call the bank]
    :::urgent
  done[Done]
```

## kb-markdown-strings

```mermaid
kanban
  todo["`**Urgent** things`"]
    a["`Fix *now*`"]
    b["Quoted (with parens)"]
```

## kb-empty-columns

```mermaid
kanban
  Backlog
  Doing
    [Only card]
  Done
```

## kb-odd-indent

```mermaid
kanban
  todo[Todo]
    a[Normal]
      b[Deeper]
   c[Shallower]
  done[Done]
        d[Very deep]
```

## kb-meta-label-and-numbers

```mermaid
kanban
  todo[Todo]
    a[Ignored text]@{ label: "Label wins", ticket: 7, priority: 'Low' }
    b[Plain]@{ assigned: 'O''Brien', ticket: "0042" }
    c[Ticket zero]@{ ticket: 0, assigned: true }
```
