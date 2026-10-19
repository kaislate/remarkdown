# Mindmap corpus

Extra mindmap examples for the mindmap parser / edit engine tests
(tests/unit/editor/mermaid-mindmap-*.test.ts). Same format as
mermaid-corpus.md: `## heading` then a mermaid fence.

## mm-all-shapes

```mermaid
mindmap
  root((Product launch))
    Plain idea
    sq[Square box]
    rd(Rounded box)
    ci((Circle))
    ba))Big bang((
    cl)Cloudy(
    hx{{Hexagon}}
    [No id square]
```

## mm-icons-classes

```mermaid
mindmap
  root((Reading list))
    Fiction
    ::icon(fa fa-book)
      Novels
      :::urgent large
      Short stories
    Non-fiction
      ::icon(mdi mdi-skull-outline)
      History
        Ancient
        :::done
```

## mm-deep-tree

```mermaid
mindmap
  Company
    Engineering
      Platform
        Storage
          Backups
            Nightly
            Weekly
        Networking
      Apps
        Web
        Mobile
    Sales
      EMEA
      Americas
    People
```

## mm-markdown-strings

```mermaid
mindmap
  id1["`**Root** with a second line`"]
    id2["`A *quiet* note`"]
    id3("`Rounded **bold**`")
    plain["Quoted text, with comma"]
```

## mm-comments

```mermaid
mindmap
  %% The whole plan
  root[Plan]
    %% first branch
    Research

    Design
      %% nested comment
      Sketches
    %% trailing comment
```

## mm-init-directive

```mermaid
%%{init: {"theme": "forest"}}%%
mindmap
  root((Garden))
    Vegetables
      Tomatoes
    Flowers
```

## mm-frontmatter-title

```mermaid
---
title: Holiday plan
---
mindmap
  root(Holiday)
    Travel
      Flights
      Trains
    Stay
```

## mm-tabs

```mermaid
mindmap
	root[Tabbed]
		Left
			Deep left
		Right
```

## mm-four-spaces

```mermaid
mindmap
    root
        Alpha
            Alpha one
        Beta
        Gamma
            Gamma one
                Gamma deep
```

## mm-inconsistent-indent

```mermaid
mindmap
  root
      Far child
    Near child
   Odd child
        Odd grandchild
     Odd second child
```

## mm-multiline-and-tail-comments

```mermaid
mindmap
  root["`Two
  lines`"]
    a[Boxed] %% why this box
    b(("Round
    and round"))
      ::icon(fa fa-circle) %% icon note
    c
```

## mm-entities

```mermaid
mindmap
  root[Symbols #amp; signs]
    a[Semi #59; colon]
    b["#quot;Quoted#quot; (paren)"]
    Tom and Jerry
```
