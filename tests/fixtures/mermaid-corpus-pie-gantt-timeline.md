# Mermaid corpus: pie, gantt, timeline

Realistic pie / gantt / timeline diagrams for the parser oracle, the
edit property tests and the svg mapping tests. Same format as
mermaid-corpus.md: an H2 heading, then one mermaid fence.

## pie-basic

```mermaid
pie
    title Key elements in Product X
    "Calcium" : 42.96
    "Potassium" : 50.05
    "Magnesium" : 10.01
    "Iron" :  5
```

## pie-frontmatter-init

```mermaid
---
title: Browser market share
---
%%{init: {"theme": "forest"}}%%
pie
    "Chrome" : 65
    "Safari" : 19
    "Edge" : 5
    "Firefox" : 3
```

## pie-comments-showdata

```mermaid
%% Survey results, March
pie showData
    %% the title stops at a comment
    title Commute by mode %% draft
    accTitle: Commute survey
    accDescr: How 200 people get to work
    "Car" : 81
    %% walking includes running
    'Walk' : 52.5
    "Bike":40
    "Bus or tram" : 27 %% includes night bus
```

## pie-inline-title

```mermaid
pie showData title Time spent
  "Meetings" : 12
  "Deep work" : 20
  "Email" : 8
```

## pie-entities-escapes

```mermaid
pie
    title Q#59;A #amp; support
    accDescr {
        Tickets by channel,
        last quarter
    }
    "Phone #59; voice" : 30
    "Chat \"live\"" : 45
    "E-mail" : 25
```

## pie-duplicate-labels

```mermaid
pie
    title Duplicates keep the first
    "Red" : 10
    "Blue" : 20
    "Red" : 99
    "Green" : 5
```

## pie-tiny-slice

```mermaid
pie
    title Disk usage
    "System" : 400
    "Apps" : 300
    "Cache" : 2
    "Photos" : 290
```

## gantt-basic

```mermaid
gantt
    title A Gantt Diagram
    dateFormat YYYY-MM-DD
    section Section
        A task          :a1, 2026-01-01, 30d
        Another task    :after a1, 20d
    section Another
        Task in Another :2026-01-12, 12d
        another task    :24d
```

## gantt-status-flags

```mermaid
gantt
    dateFormat  YYYY-MM-DD
    title       Adding GANTT diagram functionality to mermaid
    excludes    weekends

    section A section
    Completed task            :done,    des1, 2026-01-06,2026-01-08
    Active task               :active,  des2, 2026-01-09, 3d
    Future task               :         des3, after des2, 5d
    Future task2              :         des4, after des3, 5d

    section Critical tasks
    Completed task in the critical line :crit, done, 2026-01-06,24h
    Implement parser and jison          :crit, done, after des1, 2d
    Create tests for parser             :crit, active, 3d
    Future task in critical line        :crit, 5d
    Create tests for renderer           :2d
    Add to mermaid                      :until isadded
    Functionality added                 :milestone, isadded, 2026-01-25, 0d

    section Documentation
    Describe gantt syntax               :active, a1, after des1, 3d
    Add gantt diagram to demo page      :after a1  , 20h
    Add another diagram to demo page    :doc1, after a1  , 48h
```

## gantt-frontmatter-compact

```mermaid
---
title: Release train
displayMode: compact
---
%%{init: {"gantt": {"barHeight": 24}}}%%
gantt
    dateFormat YYYY-MM-DD
    axisFormat %d %b
    todayMarker off
    section Web
    Design      :w1, 2026-03-02, 5d
    Build       :w2, after w1, 10d
    section Mobile
    Design      :m1, 2026-03-04, 4d
    Build       :m2, after m1 w1, 12d
    Launch      :milestone, after w2 m2, 0d
```

## gantt-day-month-year

```mermaid
gantt
    title Kitchen renovation
    dateFormat DD-MM-YYYY
    tickInterval 1week
    section Demolition
    Strip out        :strip, 02-03-2026, 04-03-2026
    Skip collection  :05-03-2026, 1d
    section Fitting
    Plumbing         :plumb, after strip, 3d
    Electrics        :elec, 09-03-2026, 3d
    Cabinets         :crit, cab, after plumb elec, 1w
```

## gantt-hours

```mermaid
gantt
    title Launch day
    dateFormat YYYY-MM-DD HH:mm
    axisFormat %H:%M
    section Morning
    Final checks   :chk, 2026-05-04 08:00, 2h
    Go / no-go     :milestone, gonogo, 2026-05-04 10:00, 0h
    section Afternoon
    Deploy         :crit, active, dep, after gonogo, 90m
    Monitor        :mon, after dep, 3h
```

## gantt-until-click-vert

```mermaid
gantt
    title Hiring
    dateFormat YYYY-MM-DD
    section Pipeline
    Post job        :post, 2026-02-02, 5d
    Interviews      :intv, after post, until offer
    Offer           :offer, 2026-02-20, 2d
    Freeze          :vert, frz, 2026-02-16, 0d
    click post href "https://example.com/jobs"
    click intv call showDetails("intv")
```

## gantt-no-sections

```mermaid
gantt
    dateFormat YYYY-MM-DD
    title Weekend project
    Plan       :2026-06-06, 1d
    Shop       :4h
    Build      :done, 2d
    Paint      :active, 1d
```

## gantt-comments-settings

```mermaid
%% planning sketch
gantt
    %% settings
    title Conference
    accTitle: Conference plan
    accDescr: Talks and workshops over two weeks
    dateFormat YYYY-MM-DD
    inclusiveEndDates
    weekday monday
    excludes 2026-09-07, sunday
    includes 2026-09-13

    section Talks
    %% keynote first
    Keynote     :k1, 2026-09-01, 2026-09-02
    Track A     :ta, after k1, 3d

    section Workshops
    Hands-on    :w, 2026-09-08, 2d
```

## timeline-basic

```mermaid
timeline
    title History of Social Media Platform
    2002 : LinkedIn
    2004 : Facebook
         : Google
    2005 : YouTube
    2006 : Twitter
```

## timeline-sections

```mermaid
timeline
    title Timeline of Industrial Revolution
    section 17th-20th century
        Industry 1.0 : Machinery, Water power, Steam <br>power
        Industry 2.0 : Electricity, Internal combustion engine, Mass production
        Industry 3.0 : Electronics, Computers, Automation
    section 21st century
        Industry 4.0 : Internet, Robotics, Internet of Things
        Industry 5.0 : Artificial intelligence, Big data, 3D printing
```

## timeline-multi-events

```mermaid
timeline
    title England's History Timeline
    section Stone Age
      7600 BC : Britain's oldest known house was built in Orkney, Scotland
      6000 BC : Sea levels rise and Britain becomes an island.<br> The people who live here are hunter-gatherers.
    section Bronze Age
      2300 BC : People arrive from Europe and settle in Britain. <br>They bring farming and metalworking.
              : New styles of pottery and ways of burying the dead appear.
      2200 BC : The last major building works are completed at Stonehenge.<br> People now bury their dead in stone circles.
              : The first metal objects are made in Britain.Some other nice things happen. it is a good time to be alive.
```

## timeline-frontmatter-init

```mermaid
---
title: Product milestones
---
%%{init: {"theme": "forest"}}%%
timeline
    2024 : Prototype : First user test
    2025 : Beta
         : Public launch
    2026 : Version 2
```

## timeline-comments-entities

```mermaid
%% company history
timeline
    title Ups #amp; downs
    accTitle: Company history
    %% founding
    section Early days
    1999 : Founded in a garage # three people
    2001 # dot-com crash : Layoffs
    section Growth
    2010 : Series A #59; 40 staff
    2015 : IPO
```

## timeline-td

```mermaid
timeline TD
    title Course plan
    Week 1 : Basics : Setup
    Week 2 : Variables
    Week 3 : Functions
```
