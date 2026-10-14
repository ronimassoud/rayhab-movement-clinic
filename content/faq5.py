# -*- coding: utf-8 -*-
"""FAQ sections, after React Bits Pro's "FAQ 5": two-column FAQ with inline links.

A centred heading with a line that ends in a link to ask the clinic, then the
questions as separate tiles in two columns (one below 900px). Where an
answer has a page that goes deeper, it ends in an inline link to it.

The service pages build their FAQ from here (build_services.py). The two
hand-written FAQs, on the scoliosis rehabilitation page and the contact
page, were rebuilt through the same functions, so all six read alike.

The accordion behavior is ui.js's, unchanged: it finds the questions inside
.faq-card wherever they sit, opens the first and closes the rest.
"""

ARROW = ('<svg class="faq-link-arw" width="12" height="12" viewBox="0 0 24 24" fill="none" '
         'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" '
         'aria-hidden="true"><path d="M7 17L17 7"></path><path d="M8 7h9v9"></path></svg>')

# Question -> (path from the site root, link label). Labels are the titles
# of the pages they lead to, or the action they take.
LINKS = {
    # sports rehabilitation
    "How long until I am back playing?": ("sport/return-criteria-not-calendar.html", "Return criteria, not a calendar"),
    "Can I keep training while I rehabilitate?": ("sport/in-season-rehab.html", "Rehabilitating in-season"),
    "What if the injury keeps coming back?": ("sport/training-load-and-reinjury.html", "Why most re-injuries happen in the first month back"),
    # joint training & mobility
    "Is this just stretching?": ("mobility/passive-versus-active-range.html", "Range you can reach versus range you can control"),
    "How long before I notice a change?": ("mobility/end-range-strength.html", "End-range strength and why stretching alone stalls"),
    "Does it help with pain?": ("services/pain-management.html", "Pain management"),
    # physiotherapy and pain management share two questions
    "How many sessions will I need?": ("injury/how-long-does-rehab-take.html", "How long does rehabilitation actually take?"),
    "Will the exercises hurt?": ("exercise/sore-or-injured.html", "Sore or injured: reading the difference"),
    # scoliosis rehabilitation and contact
    "Do I need an X-ray before my first visit?": ("scoliosis/do-you-need-an-xray.html", "Do you need an X-ray before your first visit?"),
    "Can exercise make scoliosis worse?": ("scoliosis/lifting-with-scoliosis.html", "Can you lift weights with scoliosis?"),
    "Is my child too old to start?": ("scoliosis/growth-and-skeletal-maturity.html", "Growth, Risser sign and why timing matters"),
    "How is Schroth different from general physiotherapy?": ("scoliosis/schroth-vs-general-exercise.html", "Schroth, Pilates, yoga and the gym"),
    "Can I keep playing my sport?": ("scoliosis/return-to-sport.html", "Returning to sport with a known curve"),
    "How do I book?": ("book.html", "Book an assessment"),
    "Can I be seen if I am not in Lebanon?": ("book.html?type=online", "Book an online consultation"),
}


def item(i, q, a, id_prefix, prefix):
    """One question tile. The first is open, as ui.js would leave it."""
    fid = "%s%d" % (id_prefix, i)
    first = i == 1
    link = LINKS.get(q)
    more = ('<a class="faq-link" href="%s%s">%s%s</a>' % (prefix, link[0], link[1], ARROW)) if link else ''
    return ('<div class="acc-item faq-item"><h3><button class="acc-btn faq-btn" type="button" '
            'aria-expanded="%s" aria-controls="%s">%s<span class="acc-mark faq-mark" aria-hidden="true">%s</span>'
            '</button></h3><div class="acc-panel faq-panel" id="%s"%s><p>%s</p>%s</div></div>'
            % ("true" if first else "false", fid, q, "−" if first else "+",
               fid, "" if first else " hidden", a, more))


def columns(items, id_prefix, prefix):
    """The tiles in two columns, filled down the first and then the second,
    so opening one never pushes a tile across into the other column."""
    tiles = [item(i, q, a, id_prefix, prefix) for i, (q, a) in enumerate(items, 1)]
    half = (len(tiles) + 1) // 2
    return ('<div class="faq-card faq5-cols" data-reveal="children" data-reveal-stagger="80">'
            '<div class="faq5-col">%s</div><div class="faq5-col">%s</div></div>'
            % (''.join(tiles[:half]), ''.join(tiles[half:])))


def stack(items, id_prefix, prefix):
    """The tiles in one column, for a FAQ that sits beside something else."""
    return ('<div class="faq-card faq5-stack" data-reveal="children" data-reveal-stagger="50">%s</div>'
            % ''.join(item(i, q, a, id_prefix, prefix) for i, (q, a) in enumerate(items, 1)))


def section(items, id_prefix, prefix, title="Common questions"):
    return '''<section class="faq5 s-tint" aria-labelledby="%(id)s-h">
    <div class="faq5-head" data-reveal>
      <h2 class="faq5-title" id="%(id)s-h">%(title)s</h2>
      <p class="faq5-sub">Not finding your question? <a class="faq5-talk" href="%(prefix)scontact.html#ask">Ask the clinic <span class="arw" aria-hidden="true">&#8594;</span></a></p>
    </div>
    %(cols)s
  </section>''' % {"id": id_prefix, "title": title, "prefix": prefix,
                   "cols": columns(items, id_prefix, prefix)}
