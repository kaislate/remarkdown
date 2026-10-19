# Class & ER diagram corpus

Realistic class and ER diagrams for the class / ER parsers and edit
engines (tests/unit/editor/mermaid-class-*.test.ts, mermaid-er-*).
Every block here is valid mermaid 11.14.

## class-animals-basic

```mermaid
classDiagram
    class Animal {
        +String name
        +int age
        +makeSound() void
    }
    class Dog {
        +String breed
        +fetch() void
    }
    class Cat {
        -bool indoor
        +purr() void
    }
    Animal <|-- Dog
    Animal <|-- Cat
```

## class-all-relations

```mermaid
classDiagram
    %% every relationship kind mermaid knows
    Vehicle <|-- Car : inheritance
    Car *-- Engine : composition
    Car o-- Wheel : aggregation
    Driver --> Car : association
    Car -- Road : link
    Car ..> Fuel : dependency
    Car ..|> Drivable : realization
    Car .. Garage : dashed link
    Truck --|> Vehicle
    Trailer <--> Truck
    Engine <|--|> Motor
```

## class-cardinalities

```mermaid
classDiagram
    Customer "1" --> "*" Order : places
    Order "1" *-- "1..*" LineItem : contains
    LineItem "many" --> "1" Product
    Customer "0..1" -- Address
    Product -- "0..n" Tag
```

## class-generics-and-members

```mermaid
classDiagram
    class Repository~T~ {
        <<interface>>
        +findById(int id) T
        +findAll() List~T~
        +save(T entity)$ void
        +count()* long
    }
    class Cache~K, V~
    class UserRepository {
        -Map~int, User~ users
        -int hits$
        #List~List~String~~ log
        ~String pkg
        +String name*
    }
    Repository~T~ <|.. UserRepository
    UserRepository : +clear() void
    UserRepository : +size int
```

## class-annotations

```mermaid
classDiagram
    class Shape {
        <<abstract>>
        +area() double
    }
    class Drawable
    <<interface>> Drawable
    class Logger <<service>>
    class Color {
        <<enumeration>>
        RED
        GREEN
        BLUE
    }
    Shape ..|> Drawable
```

## class-namespaces

```mermaid
classDiagram
    namespace Shapes {
        class Triangle
        class Rectangle {
            +double width
            +double height
        }
    }
    namespace Company.Billing {
        class Invoice
        class Payment["Payment record"]
    }
    class Canvas
    Canvas o-- Triangle
    Canvas o-- Rectangle
    Invoice "1" --> "0..*" Payment : settled by
```

## class-notes

```mermaid
classDiagram
    note "Domain model — draft"
    class Account {
        +deposit(amount) bool
        +withdraw(amount) bool
    }
    note for Account "Balances are kept in cents"
    class Ledger
    Account --> Ledger
    note for Ledger "Append only"
```

## class-labels-and-names

```mermaid
classDiagram
    class Dog["Good dog"]
    class `Weird Name`
    class api.v1.Client
    class Order-Item
    class Tricky["a #quot;quoted#quot; label #59; with #35; entities"]
    Dog --> `Weird Name` : barks at
    api.v1.Client ..> Order-Item
    Tricky -- Dog
```

## class-styling-and-links

```mermaid
classDiagram
    class Service:::important {
        +run() void
    }
    class Client
    class Store
    Client --> Service
    Service --> Store
    classDef important fill:#f96,stroke:#333
    cssClass "Client,Store" muted
    style Store fill:#bbf
    link Client "https://example.com/client" "Open client docs"
    click Service href "https://example.com/service"
    callback Store "storeCallback" "Store tooltip"
```

## class-direction-init

```mermaid
%%{init: {"theme": "forest"}}%%
classDiagram
    direction LR
    class Producer {
        +produce() Item
    }
    class Consumer {
        +consume(Item i) void
    }
    Producer ..> Consumer : sends
```

## class-frontmatter-title

```mermaid
---
title: Library system
---
classDiagram-v2
    %% v2 header is an alias of classDiagram
    class Book {
        +String isbn
        +String title
    }
    class Member {
        +borrow(Book b) bool
    }
    Member "0..*" --> "0..5" Book : borrows

    %% trailing comment
```

## class-lollipop

```mermaid
classDiagram
    class Plugin
    Plugin --() Runnable
    Closeable ()-- Plugin
    Plugin --> Host
```

## class-member-lines-only

```mermaid
classDiagram
    Duck : +String beakColor
    Duck : +swim()
    Duck : +quack()
    Fish : -int sizeInFeet
    Fish : -canEat()
    Duck <|-- Mallard
```

## class-empty-bodies

```mermaid
classDiagram
    class Empty {}
    class Spaced {
    }
    class Inline { +x }
    Empty --> Spaced
```

## class-mixed-forms

```mermaid
classDiagram
  class Person {
    +String firstName
    +String lastName
    +greet() String
  }
  Person : +int age
  Person : +birthday() void
  class Person["A person"]
  Person "1" o-- "0..*" Person : knows
```

## er-shop-basic

```mermaid
erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
    CUSTOMER }|..|{ DELIVERY-ADDRESS : uses
    PRODUCT ||--o{ LINE-ITEM : "ordered in"
```

## er-attributes-keys-comments

```mermaid
erDiagram
    CUSTOMER {
        string name "full name"
        string email PK "login"
        int loyaltyPoints
    }
    ORDER {
        int id PK
        int customerId FK "references CUSTOMER"
        date placedAt
        string status
    }
    PRODUCT {
        string sku PK, UK
        string name
        decimal price "in EUR"
        List~string~ tags
    }
    CUSTOMER ||--o{ ORDER : places
    ORDER }o--o{ PRODUCT : includes
```

## er-aliases

```mermaid
erDiagram
    p[Person] {
        string firstName
        string lastName
    }
    a["Customer Account"] {
        string email PK
    }
    INV["Invoice"]
    p ||--o| a : has
    a ||--o{ INV : "is billed"
```

## er-word-cardinalities

```mermaid
erDiagram
    PERSON one or more to zero or many CAR : drives
    PERSON only one optionally to zero or one PASSPORT : holds
    CAR 1+ -- 0+ TRIP : makes
    TRIP many(0) .- many(1) STOP : "passes"
    BUILDING one to one ADDRESS : "located at"
```

## er-all-symbols

```mermaid
erDiagram
    A |o--o| B : "zero or one"
    C ||--|| D : "exactly one"
    E }o--o{ F : "zero or more"
    G }|--|{ H : "one or more"
    I ||..o{ J : "non identifying"
    K u--o{ L : "md parent"
```

## er-direction-styling

```mermaid
%%{init: {"theme": "neutral"}}%%
erDiagram
    direction LR
    %% styling statements
    DEPARTMENT ||--|{ EMPLOYEE : employs
    EMPLOYEE {
        int id PK
        string name
    }
    DEPARTMENT:::highlight
    classDef highlight fill:#f9f,stroke:#333
    class EMPLOYEE highlight
    style DEPARTMENT fill:#bbf
```

## er-frontmatter-title

```mermaid
---
title: School
---
erDiagram
    %% students and courses
    STUDENT }o--o{ COURSE : enrolls
    COURSE {
        string code PK
        string title
        int credits
    }

    TEACHER ||--o{ COURSE : teaches
```

## er-quoted-names

```mermaid
erDiagram
    "Line Item" {
        int qty
    }
    "Order Header" ||--|{ "Line Item" : contains
    EMPTY_ENTITY
    "Order Header" {}
```

## er-self-and-duplicates

```mermaid
erDiagram
    EMPLOYEE ||--o{ EMPLOYEE : manages
    EMPLOYEE ||--|| DESK : uses
    EMPLOYEE ||--|| DESK : uses
    EMPLOYEE {
        string(10) code
        varchar[64] name
        *int star
    }
```
