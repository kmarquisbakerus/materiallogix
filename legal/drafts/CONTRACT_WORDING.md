# Draft contract wording for outside counsel

**Status: a draft for your lawyer to review, edit and place. It is not in force
and is not published.** `legal/drafts/` is excluded from the deploy package by
`.github/workflows/package-cloudflare-upload.yml` and refused by `_worker.js`,
so nothing here is served from materiallogix.com.

Every clause exists for one of two reasons: a statement currently in the
customer-facing documents is not true of the code as shipped, or a disclosure
a regulator asks for first is absent. Where a clause depends on a fact that
cannot be read out of this repository, it is left in brackets rather than
invented — there are no placeholder answers here, only placeholder questions.

Several clauses offer an (a) and a (b). Those are the places where the product
and the promise can be brought into line from either end, and the choice is a
commercial one rather than a legal one. **Whichever is adopted, the code has to
match it** — that is what put most of these on the page.

*One block. Insert where you judge best; the bracketed items are facts I do not have. Numbering is for reference
only. Every clause below exists because a statement currently in the customer-facing documents is not true of the
code as shipped, or because a required disclosure is absent.*

---

**1. Identity, contact and service of process.** MaterialLogix Studio™ is provided by LibraSide Technologies, LLC, a
[Delaware] limited liability company, registered office [full street address, city, state, postal code, United
States], company number [—], email admin@materiallogix.com. All notices, complaints, consumer enquiries, requests
under data-protection law and legal process are effective when sent to that address. Our copyright agent is
[name], at the same address; [our designation under 17 U.S.C. §512(c)(2) is registered with the U.S. Copyright
Office under agent number —] / [we have not registered a designated agent with the U.S. Copyright Office and do not
claim the safe harbour that registration confers].

**2. Plan features and availability.** The features described for each plan are those the software delivers on the
date of purchase. Where a feature is described as forthcoming, that is stated expressly beside the feature, no
charge is made for it, and no plan price is set by reference to it. We do not offer for sale, and you do not pay
for, a capability the software does not perform at the time of your purchase. If a feature you were shown as
included is not delivered within thirty days of purchase, you may cancel and receive a full refund of the fees paid
for the period in which it was missing, whether or not you have used the service, and this right is in addition to
every other remedy available to you.

**3. Previews, auditions and allowances.** [Adopt (a) or (b) and delete the other; the code must be changed to match
whichever is adopted.] *(a) Watermarked previews and auditions do not consume any monthly allowance and are not
limited in number. A preview or audition carries a visible or audible mark identifying it as such.* *(b) Every
render consumes your monthly allowance, whether or not you download the result. We do not offer an unmetered preview
or audition. Your remaining allowance is shown in Usage.* The allowance figures stated in the plan description on
our website, in these terms, and in the software are the same figures; where they differ, the higher figure applies
to you for the term in question.

**4. Watermarks and unlicensed output.** Where the software produces a file you are not licensed to receive clean,
that file carries a mark identifying it as a preview: a visible mark on an image, and both a visible and an audible
mark on a video. Removing or defeating a mark we have applied is a breach of these terms. Nothing in this clause
represents that every route by which a file may leave the software applies a mark, and we do not assert any claim
under 17 U.S.C. §1201 or any equivalent provision in respect of a file the software delivered to you without one.

**5. Provenance.** [Adopt (a) until the file carries the record; move to (b) when it does.] *(a) The Studio records
what produced each file it renders, including which generative engine, if any, was used. That record is held in the
project and in the job record for a cloud render. It is not written into the delivered media file, and it may be
edited by you.* *(b) Each file the Studio renders carries a provenance record written into the file itself, stating
what produced it and which generative engine, if any, was used. That record is written by us and is not editable
within the Studio.*

**6. Generative engines and territory.** No generative video engine is enabled in the current release; video is
produced from footage you supply, using the editorial settings you choose, and no generative model is applied. When
a generative engine is enabled, the following apply. Some engines are licensed by their publishers for a defined
territory. One engine we intend to offer, HunyuanVideo, is licensed under the Tencent Hunyuan Community License
Agreement for a territory that excludes the European Union, the United Kingdom and South Korea, and that licence
restricts the use, reproduction, modification, distribution and display of the engine's *output*, not only of the
engine. Accordingly: (i) we will not render on a territorially restricted engine for a customer located in an
excluded territory, and we determine your location from your network connection as reported by our edge network,
not from your browser, with no customer-facing override; (ii) whenever a territorially restricted engine is
offered, an engine carrying no territorial restriction is available to you on the same plan, and if no unrestricted
engine is available to you we will say so rather than render; (iii) if your location cannot be confirmed, a render
on a territorially restricted engine will not proceed until it can, and renders that do not involve such an engine
are unaffected; (iv) we will tell you which engine produced each file, in the manner described in clause 5; and
(v) if you publish output of a territorially restricted engine where people in an excluded territory can reach it,
that is your decision and your responsibility, as with every other use of your work. The licence terms and required
notices for each engine we offer are published at [legal/licenses.html] and accompany any distribution we make.
[Counsel: confirm against the licence text whether a naming, NOTICE-file or product-naming obligation applies, and
whether Wan 2.2 is in fact released under Apache-2.0; neither licence is currently shipped with the product.]

**7. Refunds.** You may cancel any purchase within fourteen days of the charge and receive a full refund, without
giving a reason and without regard to how much you have used the service. This right is in addition to any right
you have under the law where you live, including the withdrawal right under Directive 2011/83/EU and the
Consumer Contracts Regulations 2013, and nothing in these terms limits it. [Delete every usage-based condition,
including any test framed by reference to a number of "clean exports", unless and until the service records a
figure that answers that test.] Wallet credit that has not been consumed is refundable on request; credit already
consumed by a completed job is not, unless the service was defective or the law requires otherwise.

**8. Consent to process a person's face or voice.** You may create a voice profile or an identity reference set only
from your own face or voice, from a person who has given you informed consent for that purpose, or from material
expressly licensed for it. Before each such capture or import, the Studio asks you to confirm the subject's consent
and the subject's age, and records that confirmation with the resulting profile or reference set: the confirmation
text shown, the subject identifier you entered, and the time. Confirmations are given per subject; a confirmation
given for one subject is never carried over to another. A subject must be 18 or older, or 13 to 17 with a parent or
legal guardian consenting and present; captures of anyone under 13 are not permitted. We will produce the recorded
confirmation to you, or to the subject, on request. The Studio's confirmation step supports your compliance; it does
not discharge your own obligations under applicable biometric-privacy, likeness and publicity laws, including the
Illinois Biometric Information Privacy Act, the Texas Capture or Use of Biometric Identifier Act and Article 9 of
the UK and EU General Data Protection Regulation.

**9. What a cloud job sends and how long it is kept.** When you submit a cloud job, we receive and process the media
you submit, the file name you gave it, the editorial settings for that job, your brand-overlay settings if any, the
job type and state, the measured and billable duration, the quoted and settled amounts, and the country from which
the engine decision was made. Job media and output are deleted within twenty-four hours of completion. Job records
are retained for [—]. Account and licence records are retained for the life of the account and [—] afterwards.
Consent records are retained for [—] after the profile or reference set they relate to is deleted. Security and
fraud-prevention records are retained for [—]. Billing records are retained for [—] as required by tax and payment
law. Optional diagnostic events are deleted after 90 days; attribution events after 397 days.

**10. Data protection: representative, transfers and rights.** Our representative in the European Union under
Article 27 GDPR is [name, address, email]; our representative in the United Kingdom under Article 27 UK GDPR is
[name, address, email]. You may contact either directly on any matter relating to the processing of your personal
data. Our processors are Stripe, Inc. (payments), Cloudflare, Inc. (hosting, databases, security and cloud
processing) and [—]; the current list is maintained at [legal/subprocessors.html] and we will give at least thirty
days' notice before adding or replacing one. Personal data is processed in the United States [and —]; transfers out
of the EEA and the UK are made under the [Standard Contractual Clauses / UK Addendum / Data Privacy Framework], a
copy of which is available on request. You have the rights to access, correct, delete, port, restrict and object,
and to withdraw a consent at any time without affecting processing already carried out; to exercise any of them
write to admin@materiallogix.com or to our postal address above, and we will respond within thirty days. You may
lodge a complaint with your supervisory authority.

**11. Security incidents.** If we become aware of a personal-data breach affecting you, we will notify the competent
supervisory authority within 72 hours where the law requires it, and notify you without undue delay where the breach
is likely to result in a high risk to your rights and freedoms. Report a suspected incident to
admin@materiallogix.com with "SECURITY" in the subject.

**12. Cookies, fonts and tracking.** The website and the Studio set only the storage strictly necessary to operate
your session, your licence and your saved work. No analytics, advertising or profiling storage is set before you
choose it. [Adopt (a) or (b).] *(a) Our pages load typefaces from Google's servers, which transmits your IP address
to Google LLC; if you would rather that did not happen, [we serve the fonts from our own domain / use the control
at —].* *(b) We serve all typefaces from our own domain and no third party receives your IP address from loading
our pages.* We honour the Global Privacy Control signal for any use that would otherwise constitute a sale or share
of personal information.

**13. Accessibility.** We aim to meet WCAG 2.2 Level AA and EN 301 549 across the website and the Studio. Our
accessibility statement, describing our current conformance, the known exceptions, the date of the most recent
assessment and how to request an accessible alternative or report a barrier, is published at
[legal/accessibility.html] and reviewed at least annually. Accessibility feedback:
admin@materiallogix.com, or our postal address above, [and the enforcement body in your country is —].

**14. Governing law, forum and mandatory consumer protection.** These terms are governed by the laws of the District
of Columbia, USA, and the state and federal courts sitting in the District of Columbia have [non-]exclusive
jurisdiction. Nothing in this clause deprives a consumer of the protection of the mandatory rules of the law of the
country in which they are habitually resident, and a consumer resident in the European Union, the United Kingdom or
Switzerland may bring proceedings in, and rely on the mandatory consumer law of, their own country. [If arbitration
and a class-action waiver are intended, they must be drafted expressly, with an opt-out, and expressly disapplied to
consumers in the EU, the UK and any other jurisdiction where they are unenforceable — at present the terms contain
neither, so every dispute defaults to court.]

**15. Age.** You must be 18 or older, or the age of legal majority where you live, to create an account or buy a
plan. We do not knowingly accept an account or a payment from anyone younger, and we will close an account and
refund the unused balance on learning of one. This is separate from clause 8, which governs the age of a person
whose face or voice is captured, and neither clause relaxes the other.

---

**One drafting note for counsel.** Every clause above became necessary because a statement in the current documents
outran the code. The durable fix is procedural, not textual: no sentence should be added to a customer-facing
document unless a test names the function that keeps it and fails when that function stops being called. Three tests
in this repository already work that way and are the model —
`tests/pricing.test.mjs:337` (`delivery: deliveryRulesFor(lane, 'video')`), `:228`
(`scriptAllowance(laneFor(`) and `tests/model-licence.test.mjs:145` (every Pro Motion Engine claim on the site
carries its footnote mark). The Pro tests at `tests/published-prices.test.mjs:125-132` are the counter-model: they
assert the field exists and never ask whether anything reads it, and that is how two plans came to be on sale on the
strength of three fields nothing reads.
