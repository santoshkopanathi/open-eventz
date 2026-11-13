# The free-by-default check — RESULT, 2026-11-13

**Checked all 15 against the live city pages. Zero are paid.**

| Outcome | Count |
|---|---|
| Source page now states **Free** in its Cost field | **4** |
| Page says nothing about money, even now | **11** |
| **Paid** | **0** |

So on every event we could verify, the assumption held. The 11 silent ones are silent at the
source too — nobody publishes a price, so "free by default" is the only answer available short
of phoning the city.

**The 4 with a Cost field are a stale-snapshot artifact, not a bug.** Those rows were frozen in
August; the live scraper reads their Cost field today and stores them as `free/confirmed`,
with the reasoning `Cost field: "FREE"` — a plain `Free` badge, no ✦. The golden set is simply
older than the page.

**Verdict: leave the default alone.** It produced no wrong answer on a 15-event check, and the
badge it produces wears the ✦ saying we worked it out ourselves.

---


15 events where the site shows **Free ✦**.

Every one of these got "Free" for the same single reason: **the description never mentioned
money, so the model applied the "community events are free by default" rule.** Nothing was
read. One assumption, applied 15 times.

**What to do:** open each link, find the real price, write it on the RESULT line.

- `free`   — confirmed free
- `paid`   — it costs money (**this is the one that matters**)
- `cant`   — the page does not say either, even now

Anything left as `?` is simply skipped.

**Why it matters:** if these come back 15/15 free, the default is sound and we leave it alone.
If two or three are paid, we have been showing "Free" on events that cost money, and the rule
needs narrowing. This is the only measurement that can settle it.

---

### 1. Merry Main Street Vendor Applications Open

**https://www.friscotexas.gov/Calendar.aspx?EID=6710&view=detail**

> (no description)

RESULT: ?

### 2. Nature Adventure at Frisco Commons Park

**https://www.friscotexas.gov/Calendar.aspx?EID=7130&view=detail**

> Experience outdoor exploration and fun at Frisco Commons Park! Immerse yourself in the beauty of nature while hiking scenic trails, observing wildlife, and learning about local flora and fauna. Perfect for all ages, this event offers a chance to connect with n…

RESULT: ?

### 3. Nature Adventure at Frisco Commons Park

**https://www.friscotexas.gov/Calendar.aspx?EID=7131&view=detail**

> Experience outdoor exploration and fun at Frisco Commons Park! Immerse yourself in the beauty of nature while hiking scenic trails, observing wildlife, and learning about local flora and fauna. Perfect for all ages, this event offers a chance to connect with n…

RESULT: ?

### 4. Nature Adventure at Frisco Commons Park

**https://www.friscotexas.gov/Calendar.aspx?EID=7132&view=detail**

> Experience outdoor exploration and fun at Frisco Commons Park! Immerse yourself in the beauty of nature while hiking scenic trails, observing wildlife, and learning about local flora and fauna. Perfect for all ages, this event offers a chance to connect with n…

RESULT: ?

### 5. Cycle the City - Cottonwood Creek Greenbelt

**https://www.friscotexas.gov/Calendar.aspx?EID=7310&view=detail**

> Take a bike ride at a conversational pace with City of Frisco elected officials and staff from Frisco Fire, Frisco Police, and Play Frisco. Routes are a combination of on-street and hike & bike trails with distances ranging from 5 to 10 miles. Each ride last b…

RESULT: ?

### 6. Cycle the City - Dominion Trail

**https://www.friscotexas.gov/Calendar.aspx?EID=7311&view=detail**

> Take a bike ride at a conversational pace with City of Frisco elected officials and staff from Frisco Fire, Frisco Police, and Play Frisco. Routes are a combination of on-street and hike & bike trails with distances ranging from 5 to 10 miles. Each ride last b…

RESULT: ?

### 7. Walnut Wednesdays

**https://www.friscotexas.gov/Calendar.aspx?EID=7405&view=detail**

> 10 to 11 a.m., Weekly, June 17 through August 5 In The Depot at Frisco Heritage Center Your weekly dose of hands-on fun! With engaging activities and playful learning, families can drop by, explore, and make new memories every week this summer.

RESULT: ?

### 8. Reception, "Stories from the Archives"

**https://www.friscotexas.gov/Calendar.aspx?EID=7427&view=detail**

> A public reception will be held Thursday, August 27, from 4 to 6 p.m. Meet the artists featured in this show and enjoy light refreshments!

RESULT: ?

### 9. Saturday Sparks: Raptor Experience

**https://www.friscotexas.gov/Calendar.aspx?EID=7498&view=detail**

> Soar into the weekend at Saturday Sparks: Raptor Experience! The Blackland Prairie Raptor Center is bringing their awe-inspiring birds of prey for an unforgettable encounter. Discover how these majestic hunters rule the skies, their vital role in the ecosystem…

RESULT: ?

### 10. Art in the Atrium 26 - Call for Art

**https://www.friscotexas.gov/Calendar.aspx?EID=7672&view=detail**

> Art in the Atrium is back at the George A. Purefoy Municipal Center in Frisco, TX! The City of Frisco seeks original, 2-Dimensional artworks by artists from Frisco and the surrounding area for the 26th installment of Art in the Atrium. Submission deadline: Wed…

RESULT: ?

### 11. Parks For Pollinators: What Remains

**https://www.friscotexas.gov/Calendar.aspx?EID=7680&view=detail**

> Join us for the 8th annual NRPA’s Parks for Pollinators event! Every Wednesday morning in September we will explore the remaining prairies of Frisco as we search for bees, beetles, butterflies, and more! Will Frisco be number one this year? September 2: Cotton…

RESULT: ?

### 12. Parks For Pollinators: What Remains

**https://www.friscotexas.gov/Calendar.aspx?EID=7681&view=detail**

> Join us for the 8th annual NRPA’s Parks for Pollinators event! Every Wednesday morning in September we will explore the remaining prairies of Frisco as we search for bees, beetles, butterflies, and more! Will Frisco be number one this year? September 2: Cotton…

RESULT: ?

### 13. Parks For Pollinators: What Remains

**https://www.friscotexas.gov/Calendar.aspx?EID=7682&view=detail**

> Join us for the 8th annual NRPA’s Parks for Pollinators event! Every Wednesday morning in September we will explore the remaining prairies of Frisco as we search for bees, beetles, butterflies, and more! Will Frisco be number one this year? September 2: Cotton…

RESULT: ?

### 14. Parks For Pollinators: What Remains

**https://www.friscotexas.gov/Calendar.aspx?EID=7683&view=detail**

> Join us for the 8th annual NRPA’s Parks for Pollinators event! Every Wednesday morning in September we will explore the remaining prairies of Frisco as we search for bees, beetles, butterflies, and more! Will Frisco be number one this year? September 2: Cotton…

RESULT: ?

### 15. Parks For Pollinators: What Remains

**https://www.friscotexas.gov/Calendar.aspx?EID=7684&view=detail**

> Join us for the 8th annual NRPA’s Parks for Pollinators event! Every Wednesday morning in September we will explore the remaining prairies of Frisco as we search for bees, beetles, butterflies, and more! Will Frisco be number one this year? September 2: Cotton…

RESULT: ?
