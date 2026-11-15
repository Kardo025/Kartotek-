/*
 * Exam prep data and study generator (UI-independent): CEnT-S and the TU Delft AE selection exam
 * - SECTIONS: the five CEnT-S sections with the OpenStax books and the syllabus items (PDF page ranges).
 * - TUD: the three TU Delft AE selection sections. An item given only by its id ("at3.1") is the same topic as in
 *   CEnT-S: one item, one study, one done mark, shown in both exams.
 * - buildPackage(): turns one item into a reading study package (etut.json shape) for the Study tab.
 */
(function (global) {
  'use strict';
var PDF = "https://assets.openstax.org/oscms-prodcms/media/documents/";
var OS = function (s) { return "https://openstax.org/details/books/" + s; };
var THEMES = {
  paper: { "--paper": "#f6f7f3", "--grid": "rgba(64,104,150,.13)", "--margin": "rgba(217,67,75,.75)", "--panel": "#fbfbf8", "--panel-soft": "rgba(251,251,248,.86)",
    "--text": "#22262c", "--head": "#1b1f24", "--muted": "#5a616a", "--line-strong": "#2f343b", "--rule": "#c3ccd7", "--row-rule": "#d6dde6",
    "--ink": "#1d3fb8", "--ink-strong": "#132c86", "--ink-soft": "#e4e9fb", "--hover": "#eef1fb", "--row-hover": "rgba(29,63,184,.05)",
    "--sq": "rgba(64,104,150,.16)", "--opt": "#8a5a00", "--gap": "#c0313a" },
  blueprint: { "--paper": "#0f2a52", "--grid": "rgba(173,205,245,.14)", "--margin": "rgba(255,140,120,.7)", "--panel": "#123262", "--panel-soft": "rgba(18,50,98,.86)",
    "--text": "#e8f0fb", "--head": "#f4f8ff", "--muted": "#a9bfdc", "--line-strong": "#cfe0f6", "--rule": "#4b6a95", "--row-rule": "#2d4d7a",
    "--ink": "#ffe07a", "--ink-strong": "#fff1b8", "--ink-soft": "rgba(255,224,122,.14)", "--hover": "rgba(255,255,255,.06)", "--row-hover": "rgba(255,224,122,.06)",
    "--sq": "rgba(173,205,245,.2)", "--opt": "#ffc46b", "--gap": "#ff9a8a" }
};
var BOOKS = {
  at: { short: "A&T 2e", name: "Algebra and Trigonometry 2e", url: OS("algebra-and-trigonometry-2e"), pdf: PDF + "algebra-and-trigonometry-2e_-_WEB.pdf", off: 10 },
  cm: { short: "Contemporary Math", name: "Contemporary Mathematics", url: OS("contemporary-mathematics"), pdf: PDF + "contemporary-mathematics_-_WEB.pdf", off: 10 },
  is: { short: "Intro Statistics 2e", name: "Introductory Statistics 2e", url: OS("introductory-statistics-2e"), pdf: PDF + "introductory-statistics-2e_-_WEB.pdf", off: 12 },
  ka: { short: "Khan Academy", name: "Khan Academy, Geometry", url: "https://www.khanacademy.org/math/geometry" },
  cb: { short: "Concepts of Biology", name: "Concepts of Biology", url: OS("concepts-biology"), pdf: PDF + "Concepts-Biology_-_WEB.pdf", off: 14 },
  b2: { short: "Biology 2e", name: "Biology 2e", url: OS("biology-2e"), pdf: PDF + "Biology-2e_-_WEB.pdf", off: 20 },
  ch: { short: "Chemistry 2e", name: "Chemistry 2e", url: OS("chemistry-2e"), pdf: PDF + "chemistry-2e_-_WEB.pdf", off: 14 },
  ph: { short: "HS Physics", name: "Physics (High School)", url: OS("physics"), pdf: PDF + "Physics_-_WEB.pdf", off: 12 },
  cp: { short: "College Physics 2e", name: "College Physics 2e", url: OS("college-physics-2e"), pdf: PDF + "college-physics-2e_-_WEB.pdf", off: 18 },
  c1: { short: "Calculus 1", name: "Calculus Volume 1", url: OS("calculus-volume-1"), pdf: PDF + "calculus-volume-1_-_WEB.pdf", off: 8 },
  c3: { short: "Calculus 3", name: "Calculus Volume 3", url: OS("calculus-volume-3"), pdf: PDF + "calculus-volume-3_-_WEB.pdf", off: 8 },
  fys: { short: "Alderliesten ch. 5", name: "Introduction to Aerospace Structures and Materials (R.C. Alderliesten, TU Delft Open Textbook), chapter 5", url: "https://textbooks.open.tudelft.nl/textbooks/catalog/book/15" },
  fya: { short: "TU Delft lectures", name: "Aerodynamics (TU Delft video lectures)", url: "https://ocw.tudelft.nl/course-lectures/1-fundamentals-aerodynamics/" },
  fyf: { short: "TU Delft lectures", name: "Flight mechanics (TU Delft video lectures)", url: "https://ocw.tudelft.nl/course-lectures/1-introduction-flight-mechanics/" },
  fyp: { short: "DLE lectures", name: "Space (video lectures on the Digital Learning Environment only)" },
  rc: { short: "B2 reading", name: "Reading and comprehension (B2 English texts, no set book)" },
  up: { short: "University Physics 1", name: "University Physics Volume 1", url: OS("university-physics-volume-1"), pdf: PDF + "university-physics-volume-1_-_WEB.pdf", off: 12 }
};
var DATA = [
 // CEnT-S 2026-27 (cisiaonline.it structure page): Reading and comprehension comes first, 10 questions in 30 minutes
 { id: "read", name: "Reading and comprehension", q: 10, min: 30, books: [
  { b: "rc", items: [
   ["rc-1", "B2", "Reading B2 texts (non-fiction, literary, journalistic): main idea, relations between parts, implicit and implied meaning", "", []]
  ], note: "CISIA says no specific preparation is required. Practise with timed B2 texts: the mock exams include this section." }
 ] },
 { id: "math", name: "Mathematics", q: 15, min: 30, books: [
  { b: "at", items: [
   ["at1.1","1.1","Real Numbers","",[[17,32]]],["at1.2","1.2","Exponents & Scientific Notation","",[[33,47]]],["at1.3","1.3","Radicals & Rational Exponents","",[[48,57]]],
   ["at1.4","1.4","Polynomials","gap",[[58,66]]],["at1.5","1.5","Factoring Polynomials","gap",[[67,75]]],["at1.6","1.6","Rational Expressions","opt",[[76,83]]],
   ["at2.1","2.1","Rectangular Coordinate Systems (iki nokta arası uzaklık)","",[[91,105]]],["at2.2","2.2","Linear Equations","",[[106,121]]],
   ["at2.3","2.3","Models & Applications (sözel problemler)","",[[122,131]]],["at2.5","2.5","Quadratic Equations","",[[141,154]]],["at2.6","2.6","Other Types of Equations","opt",[[155,166]]],
   ["at2.7","2.7","Linear & Absolute Value Inequalities","",[[167,176]]],
   ["at3.1","3.1","Functions & Function Notation","",[[185,207]]],["at3.2","3.2","Domain & Range","",[[208,225]]],["at3.3","3.3","Rates of Change & Behavior of Graphs","",[[226,242]]],
   ["at3.4","3.4","Composition of Functions","gap",[[243,257]]],["at3.5","3.5","Transformation of Functions","gap",[[258,288]]],["at3.6","3.6","Absolute Value Functions","",[[289,296]]],
   ["at3.7","3.7","Inverse Functions","gap",[[297,312]]],
   ["at4.1","4.1","Linear Functions (eğim, doğru denklemi, grafik, kesişim)","gap",[[325,360]]],["at4.2","4.2","Modeling with Linear Functions","opt",[[361,374]]],
   ["at5.1","5.1","Quadratic Functions (parabol)","",[[399,417]]],["at5.2","5.2","Power & Polynomial Functions","opt",[[418,438]]],
   ["at5.6","5.6","Rational Functions (sadece 1/(ax+b))","gap",[[483,507]]],
   ["at6.1","6.1","Exponential Functions","",[[538,555]]],["at6.2","6.2","Graphs of Exponential Functions","",[[556,568]]],["at6.3","6.3","Logarithmic Functions","",[[569,578]]],
   ["at6.4","6.4","Graphs of Logarithmic Functions","",[[579,599]]],["at6.5","6.5","Logarithmic Properties","",[[600,611]]],["at6.6","6.6","Exponential & Logarithmic Equations","",[[612,623]]],
   ["at7.2","7.2","Right Triangle Trigonometry (fizik için)","",[[699,710]]],
   ["at11.1","11.1","Systems of Linear Equations: Two Variables","gap",[[1012,1029]]],["at11.3","11.3","Nonlinear Systems & Inequalities (düzlem bölgeleri)","gap",[[1041,1052]]],
   ["at13.5","13.5","Counting Principles","",[[1253,1263]]],["at13.7","13.7","Probability","",[[1270,1280]]]
  ], skip: "Atla: 2.4, 4.3, 5.3-5.5, 6.7-6.8, 11.2 ve 11.4-11.8, 13.1-13.4, 13.6" },
  { b: "cm", items: [
   ["cm3","3.1-3.6","Sayı sistemleri, asal çarpanlar, bölünebilme","gap",[[138,220]]],
   ["cm7a","7.1-7.3","Sayma kuralı, permütasyon, kombinasyon","",[[734,747]]],
   ["cm7b","7.4-7.9","Olasılık, toplama kuralı, bağımsız olaylar","",[[748,799]]],
   ["cm8","8.1-8.3","Veri düzenleme, grafikler, ortalama, medyan, mod","",[[826,882]]],
   ["cm10","10.1-10.4, 10.6-10.7","Açılar, üçgenler, çokgenler, çember, alan, hacim","",[[1004,1061],[1078,1107]]]
  ] },
  { b: "is", items: [
   ["is1.3","1.3","Levels of Measurement (nominal, ordinal, interval, ratio)","gap",[[38,45]]],
   ["is2","2.1-2.2","Grafikler ve histogram","opt",[[78,97]]]
  ] },
  { b: "ka", items: [["ka-circle","Ünite","Circle equations (çember denklemi)","",[]]] }
 ] },
 { id: "reason", name: "Reasoning", q: 15, min: 30, books: [
  { b: "cm", items: [
   ["cm1","1.1-1.5","Kümeler, Venn diyagramları, küme işlemleri","",[[16,60]]],
   ["cm2.1","2.1","Statements & Quantifiers","",[[70,79]]],["cm2.2","2.2","Compound Statements","",[[80,87]]],["cm2.3","2.3","Constructing Truth Tables","",[[88,96]]],
   ["cm2.4","2.4","Conditional & Biconditional","",[[97,105]]],["cm2.5","2.5","Equivalent Statements","",[[106,111]]],["cm2.6","2.6","De Morgan's Laws","",[[112,117]]],
   ["cm2.7","2.7","Logical Arguments","",[[118,125]]]
  ], note: "Veri okuma (CM 8.1-8.3) ve sözel problemler (A&T 2.3) Mathematics sayfasında." }
 ] },
 { id: "bio", name: "Biology", q: 10, min: 20, books: [
  { b: "cb", items: [
   ["cb2","Ch. 2","Chemistry of Life (su, makromoleküller)","",[[43,70]]],["cb3","Ch. 3","Cell Structure & Function","",[[71,104]]],
   ["cb4","Ch. 4","How Cells Obtain Energy","opt",[[105,130]]],["cb5","Ch. 5","Photosynthesis","",[[131,148]]],
   ["cb6","Ch. 6","Reproduction at the Cellular Level (hücre döngüsü, mitoz)","",[[149,164]]],["cb7","Ch. 7","Cellular Basis of Inheritance (mayoz)","",[[165,184]]],
   ["cb8","Ch. 8","Patterns of Inheritance (Mendel)","",[[185,210]]],["cb9","Ch. 9","Molecular Biology (DNA, transkripsiyon, translasyon)","",[[211,236]]],
   ["cb16","Ch. 16","The Body's Systems","",[[409,456]]],["cb19","19.4","Community Ecology (türler arası etkileşimler)","",[[522,531]]],["cb20","Ch. 20","Ecosystems (enerji akışı, besin zinciri)","",[[537,574]]]
  ], skip: "Atla: Ch. 10-15, 17-18, 19.1-19.3, 21" },
  { b: "b2", items: [
   ["b30","30.1-30.4","Bitki gövdesi, gövde, kök, yaprak","",[[880,898]]],["b32","32.1","Çiçek, meyve, tohum","",[[939,948]]],["b33","33.2","Hayvan dokuları","",[[978,986]]]
  ] }
 ] },
 { id: "chem", name: "Chemistry", q: 10, min: 20, books: [
  { b: "ch", items: [
   ["c1","1.1-1.5","Madde, hal değişimi, ölçüm, belirsizlik","",[[23,52]]],["c2","2.1-2.7","Atom teorisi, izotop, bileşikler, adlandırma","",[[74,115]]],
   ["c3","3.1, 3.3-3.4","Mol, molarite, derişim birimleri","",[[129,139],[147,159]]],["c3.2","3.2","Empirical formula","opt",[[140,146]]],
   ["c4","4.1-4.4","Denkleştirme, stokiyometri, sınırlayıcı reaktif, verim","",[[170,198]]],["c4.5","4.5","Quantitative analysis (titrasyon)","opt",[[199,205]]],
   ["c5","5.1, 5.3","Enerji, entalpi, ekzotermik ve endotermik","",[[220,227],[239,253]]],["c6a","6.2-6.3","Bohr modeli, kuantum sayıları","",[[276,291]]],
   ["c6b","6.4-6.5","Elektron dizilimi, periyodik özellikler","",[[292,309]]],["c7","7.1-7.3, 7.6","Bağlar, Lewis yapıları, VSEPR, polarlık","",[[321,339],[351,364]]],
   ["c8.2","8.2","Hybrid Atomic Orbitals","",[[385,394]]],["c9","9.1-9.3","Gaz basıncı, ideal gaz, kısmi basınç","",[[419,451]]],["c10.1","10.1","Intermolecular Forces","",[[478,488]]],
   ["c11","11.1-11.4","Çözünme, elektrolitler, koligatif özellikler","",[[547,581]]],["c12","12.1-12.2, 12.5, 12.7","Tepkime hızı, aktivasyon enerjisi, kataliz","",[[600,606],[624,628],[633,640]]],
   ["c13","13.1-13.3","Denge, K ve Q, Le Chatelier","",[[657,674]]],["c14","14.1-14.4, 14.6-14.7","Asit-baz, pH, hidroliz, tampon, indikatör","",[[693,720],[724,736]]],
   ["c16","16.1-16.4","Entropi, Gibbs serbest enerjisi (kavramsal)","",[[781,805]]],["c17","17.1, 17.3","Redoks denkleştirme, elektrot potansiyelleri","",[[815,818],[822,827]]],
   ["c18","18.1-18.2","Metallerin özellikleri","opt",[[853,865]]],["c20","20.1-20.3","Hidrokarbonlar, alkol, eter, aldehit, keton, asit, ester","",[[973,999]]],
   ["capp","Kutucuklar","Applied chemistry: Chemistry in Everyday Life kutuları","",[]]
  ], skip: "Atla: 5.2, 7.4-7.5, 8.4, 9.4-9.6, 11.5, 12.3-12.4, 12.6, 13.4, 14.5, 17.2, 17.4-17.7, 19, 20.4, 21" }
 ] },
 { id: "phys", name: "Physics", q: 5, min: 10, books: [
  { b: "ph", items: [
   ["p1","1.3","Physical quantities and units (SI, conversion, prefixes, scientific notation, significant figures, order of magnitude)","",[[29,52]]],
   ["p2","2.1-2.4, 3.1-3.2","Relative motion, displacement, velocity, acceleration, equations of motion, x-t, v-t and a-t graphs, free fall","",[[68,94],[109,125]]],
   ["p4.1","4.1-4.3","Force, Newton's first and second laws, weight, normal force, tension","",[[133,145]]],
   ["p5.1","5.1-5.2","Vectors: addition, subtraction, components, sin, cos, tan","",[[163,181]]],
   ["p6","6.1-6.2","Angular velocity, uniform circular motion, period, frequency, centripetal acceleration","",[[217,230]]],
   ["p7.2","7.2","Gravitational force (universal gravitation)","opt",[[255,263]]],
   ["p9","9.1-9.2","Work, power, kinetic and potential energy, conservation of energy","",[[299,309]]],
   ["p11.1","11.1-11.2","Temperature scales (Celsius, Kelvin), thermal energy, heat","",[[351,363]]],
   ["p12.1","12.1-12.3","Zeroth law, first law and thermodynamic work, second law (qualitative)","",[[382,397]]],
   ["p13","13.1-13.2","Wave motion, wavelength, frequency, wave speed v = f\u03bb","",[[417,426]]],
   ["p14.1","14.1","Sound waves: speed, frequency, wavelength","",[[443,449]]],
   ["p15","15.1","Light waves and the electromagnetic spectrum","",[[485,492]]],
   ["p18","18.1-18.3","Charge, conductors and insulators, Coulomb's law, electric field","",[[580,602]]],
   ["p19","19.1","Current, resistance, Ohm's law","",[[635,643]]],
   ["p20","20.1","Magnets, magnetic field lines","",[[681,695]]]
  ], skip: "Atla: 1.1-1.2, 4.4, 5.3-5.5, 6.3, 7.1, Ch. 8, 9.3, 10, 11.3, 12.4, 13.3, 14.2-14.4, 15.2, 16-17, 18.4-18.5, 19.2-19.4, 20.2-20.3, 21-23" },
  { b: "cp", items: [
   ["cp11","11.2-11.5, 11.7","Yoğunluk, basınç, Stevin, Pascal, Arşimet","",[[463,474],[479,485]]],["cp12","12.1-12.2","Süreklilik denklemi, Bernoulli","",[[512,519]]],["cp13.3","13.3","İdeal gaz yasası","",[[566,573]]]
  ], note: "High School Physics'te akışkanlar bölümü yok, bu kısmı buradan çalış." },
  { b: "up", items: [["up2.4","2.4","Products of Vectors (dot and cross product, conceptual)","",[[84,95]]]] },
  { b: "at", items: [["at5.8","5.8","Modeling Using Variation (direct and inverse proportionality)","",[[520,537]]]], note: "Linear, quadratic, exponential and logarithmic graphs: Mathematics sayfasında (4.1, 5.1, 6.2, 6.4)." }
 ] }
];


  // TU Delft BSc Aerospace Engineering selection exam (official syllabus v2027: Mathematics and Physics, First-year AE topics; the
  // v2027 topic lists match v2025). First-year items carry a 6th field: the lecture page URL, or "dle" for lectures that are only
  // on the Digital Learning Environment (selection platform). They have no page ranges, so srcPrompt() writes their studies.
  // A string item is a CEnT-S item reused as is ("|opt" or "|" sets this exam's tag).
  var TUD = [
   { id: "math", name: "Mathematics", q: 20, min: 30, books: [
    { b: "at", items: [
     "at1.4|", "at1.5|", "at1.6|", "at2.1|", "at2.5|", "at2.6|", "at2.7|", "at11.1|", "at11.3|",
     "at3.1|", "at3.2|", "at3.3|", "at3.4|", "at3.5|", "at3.6|opt", "at3.7|", "at4.1|", "at5.1|", "at5.2|", "at5.6|",
     "at6.1|", "at6.2|", "at6.3|", "at6.4|", "at6.5|", "at6.6|",
     ["at7.1","7.1","Angles: degrees and radians","",[[676,698]]],"at7.2|",["at7.3","7.3","Unit circle: exact values, periodicity, symmetry","",[[711,728]]],
     ["at7.4","7.4","The other trigonometric functions","opt",[[729,743]]],["at8.1","8.1","Graphs of sine and cosine: amplitude, period, phase, f(x) = a + b sin(cx - d)","",[[751,769]]],
     ["at9.1","9.1","Trigonometric identities (Pythagorean identity)","",[[811,820]]],["at9.2","9.2","Sum and difference identities","",[[821,836]]],
     ["at9.3","9.3","Double-angle formulas","",[[837,848]]],["at9.5","9.5","Solving trigonometric equations","",[[856,871]]],
     ["at10.1","10.1","Law of sines","",[[879,896]]],["at10.2","10.2","Law of cosines","",[[897,910]]],
     ["at10.6","10.6-10.7","Parametric equations and their graphs","opt",[[954,978]]],["at10.8","10.8","Vectors: magnitude, direction, components, dot product","",[[979,999]]]
    ], note: "Functions and graphs, algebraic solving, trigonometry and part of geometry and vectors." },
    { b: "cm", items: ["cm10|"], note: "Geometry: perimeter, area, volume, angles, triangles, circles." },
    { b: "ka", items: ["ka-circle|"] },
    { b: "c1", items: [
     ["c1-2.2","2.2-2.3","Limits and limit laws","",[[124,162]]],["c1-4.6","4.6","Limits at infinity and asymptotes","",[[362,388]]],
     ["c1-3.1","3.1-3.2","The derivative, tangent lines, the derivative as a function","",[[196,223]]],["c1-3.3","3.3","Differentiation rules (product and quotient rules)","",[[224,237]]],
     ["c1-3.4","3.4","Derivatives as rates of change (distance, velocity, acceleration)","",[[238,248]]],["c1-3.5","3.5","Derivatives of trigonometric functions","",[[249,257]]],
     ["c1-3.6","3.6","The chain rule","",[[258,266]]],["c1-3.9","3.9","Derivatives of exponential and logarithmic functions","",[[283,295]]],
     ["c1-4.3","4.3","Maxima and minima","",[[325,336]]],["c1-4.5","4.5","Derivatives and the shape of a graph (concavity, inflection points)","",[[347,361]]],
     ["c1-4.7","4.7","Applied optimization problems","",[[389,401]]],["c1-4.10","4.10","Antiderivatives and the constant of integration","",[[427,438]]],
     ["c1-5.2","5.2-5.3","The definite integral and the fundamental theorem of calculus","",[[464,495]]],["c1-5.4","5.4","Integration formulas and net change","",[[496,513]]],
     ["c1-5.5","5.5","Substitution (integrals of c f(ax + b) + d)","",[[514,523]]],["c1-6.1","6.1","Areas between curves","",[[548,558]]],
     ["c1-6.2","6.2","Volumes of revolution: disks and washers","",[[559,576]]],["c1-6.3","6.3","Volumes of revolution: cylindrical shells","opt",[[577,589]]],
     ["c1-6.4","6.4","Arc length and surface area of revolution","opt",[[590,601]]],["c1-6.6","6.6","Moments and centers of mass (center of gravity of 2D shapes)","",[[618,633]]]
    ], note: "Differential and integral calculus." },
    { b: "c3", items: [
     ["c3-1.1","1.1-1.2","Parametric curves and their tangent lines","",[[16,45]]],["c3-2.1","2.1","Vectors in the plane","opt",[[98,116]]],
     ["c3-2.3","2.3","The dot product: angles and projections","",[[139,156]]],["c3-2.5","2.5","Vector equation of a line (lines and planes)","",[[177,199]]],
     ["c3-3.1","3.1-3.2","Vector-valued functions and tangent vectors","",[[243,264]]],["c3-3.4","3.4","Motion along a vector path: velocity and acceleration","",[[283,303]]]
    ], note: "Vectors: lines, parametric curves and vector paths." }
   ] },
   { id: "phys", name: "Physics", q: 20, min: 30, books: [
    { b: "ph", items: [
     "p1|", "p5.1|", "p2|", "p4.1|", ["p4.4","4.4","Newton's third law","",[[146,152]]],
     ["p5.4","5.4","Inclined planes and friction (free-body diagrams)","",[[191,197]]],["p5.5","5.5","Simple harmonic motion, mass-spring systems","",[[198,204]]],
     "p6|", ["p7.1","7.1","Kepler's laws and planetary orbits","",[[247,254]]], "p7.2|",
     "p9|", ["p9.3","9.3","Simple machines and efficiency","",[[310,315]]],
     "p18|", "p19|", ["p19.2","19.2-19.3","Series and parallel circuits","",[[644,663]]],["p19.4","19.4","Electric power","",[[664,669]]],
     "p20|", ["p20.3","20.3","Electromagnetic induction and magnetic flux","",[[704,712]]],
     "p13|", ["p13.3","13.3","Superposition and interference","opt",[[427,433]]], "p14.1|", "p15|"
    ], note: "Fundamentals, mechanics, electricity and magnetism, vibrations and waves." },
    { b: "cp", items: [
     "cp11|", ["cp5.1","5.1-5.2","Friction and drag forces","",[[218,228]]],["cp7.4","7.4","Conservative forces and elastic (spring) potential energy","",[[304,307]]],
     ["cp16.7","16.7-16.8","Damped oscillations, forced oscillations and resonance","",[[723,729]]],["cp21.3","21.3","Kirchhoff's rules","",[[952,956]]],
     ["cp22.4","22.4-22.5","Lorentz force on a moving charge in a magnetic field","",[[992,998]]], "cp13.3|opt"
    ], note: "Density and pressure, drag, Kirchhoff's rules and the Lorentz force are not in High School Physics." }
   ] },
   { id: "fy", name: "First-year AE topics", q: 25, min: 30, books: [
    { b: "fys", items: [
     ["fy-s5.1","5.1","Introduction","",[]],["fy-s5.2","5.2","Airframe","",[]],["fy-s5.3","5.3","Structural concepts","",[]],
     ["fy-s5.4","5.4","Fuselage","",[]],["fy-s5.5","5.5","Wing structures","",[]],["fy-s5.6","5.6","Torsion box","",[]],
     ["fy-s5.7","5.7","Structural details","",[]],["fy-s5.8","5.8","Spacecraft structures","",[]],["fy-s5.9","5.9","Launch vehicle structures","",[]]
    ], note: "Syllabus v2027: only chapter 5, sections 5.1-5.9. References to sections, figures or equations outside them are not needed. Know every formula in the study material by heart, with its assumptions." },
    { b: "fya", items: [
     ["fy-a3","Module A, L3","How aircraft fly","",[],"https://ocw.tudelft.nl/course-lectures/3-aircraft-fly/"],
     ["fy-b1","Module B, L1","Fundamentals of aerodynamics: continuity, (in)compressible flow, momentum equation, viscous flow, lift, drag and moment coefficients","",[],"https://ocw.tudelft.nl/course-lectures/1-fundamentals-aerodynamics/"]
    ], note: "Every video on each lecture page is exam material (17 videos over the six lectures). Study time for the book and the videos: 10 to 20 hours." },
    { b: "fyf", items: [
     ["fy-c1","Module C, L1","Introduction to flight mechanics","",[],"https://ocw.tudelft.nl/course-lectures/1-introduction-flight-mechanics/"],
     ["fy-l11","Lecture 11","Flight mechanics: equations of motion, thrust, power required, altitude effects, rate of climb, gliding flight","",[],"dle"]
    ], note: "Module C Lecture 1 is open on TU Delft OpenCourseWare; Lecture 11 is only on the Digital Learning Environment." },
    { b: "fyp", items: [["fy-l4","Lecture 4","Space: launch vehicles","",[],"dle"],["fy-l5","Lecture 5","Space: orbits","",[],"dle"]], note: "Lectures 4 and 5 are only on the Digital Learning Environment (selection platform)." }
   ] }
  ];

  // ------------------------------------------------------------------ catalog: one entry per item across both exams
  var EXAMS = {
    cents: { id: 'cents', name: 'CEnT-S', long: 'the CEnT-S', sections: DATA },
    tud: { id: 'tud', name: 'TU Delft AE', long: 'the TU Delft AE selection exam', sections: TUD }
  };
  var CAT = {};
  ['cents', 'tud'].forEach(function (x) {
    EXAMS[x].sections.forEach(function (sec) {
      sec.books.forEach(function (g) {
        g.items = g.items.map(function (it) {
          if (typeof it === 'string') {
            var parts = it.split('|'), base = CAT[parts[0]];
            if (!base) throw new Error('Unknown shared item ' + parts[0]);
            var tag = parts.length > 1 ? parts[1] : base.item[3];
            base.exams.indexOf(x) < 0 && base.exams.push(x);
            return [base.item[0], base.item[1], base.item[2], tag, base.item[4]];
          }
          if (!CAT[it[0]]) CAT[it[0]] = { item: it, b: g.b, pfx: x === 'cents' ? 'cents-' : 'tud-', exams: [x], section: sec };
          else if (CAT[it[0]].exams.indexOf(x) < 0) CAT[it[0]].exams.push(x);
          return it;
        });
      });
    });
  });

  // ------------------------------------------------------------------ syllabus order: the overview lists items under the
  // official syllabus topics (CISIA CEnT-S syllabus; TU Delft AE syllabus v2027), numbered top to bottom.
  // "see" names topics studied on another section's page.
  var SYL = {
    cents: {
      read: [
        ['Reading and comprehension', ['rc-1']]
      ],
      math: [
        ['Numbers', ['at1.1', 'cm3', 'at1.2', 'at1.3']],
        ['Algebra', ['at1.4', 'at1.6', 'at1.5', 'at2.2', 'at2.3', 'at2.5', 'at2.7', 'at2.6', 'at11.1']],
        ['Geometry', ['cm10', 'at2.1', 'at4.1', 'at4.2', 'ka-circle', 'at11.3', 'at7.2']],
        ['Functions', ['at3.1', 'at3.4', 'at3.7', 'at3.2', 'at3.3', 'at3.5', 'at5.2', 'at5.1', 'at5.6', 'at3.6', 'at6.2', 'at6.4']],
        ['Exponential and logarithms', ['at6.1', 'at6.3', 'at6.5', 'at6.6']],
        ['Combinatorics and probability', ['cm7a', 'at13.5', 'cm7b', 'at13.7']],
        ['Basic statistics', ['cm8', 'is2', 'is1.3']]
      ],
      reason: [
        ['Logic and deductive reasoning', ['cm2.1', 'cm2.2', 'cm2.3', 'cm2.5', 'cm1', 'cm2.6', 'cm2.4', 'cm2.7']],
        ['Interpretation and manipulation of data', [], 'Studied on the Mathematics page: CM 8.1-8.3 (Basic statistics).'],
        ['Problem solving and basic mathematical language', [], 'Studied on the Mathematics page: A&T 2.3 word problems (Algebra).']
      ],
      bio: [
        ['Biological molecules', ['cb2']],
        ['Cell biology', ['cb3']],
        ['Cell cycle, cell division, inheritance', ['cb9', 'cb6', 'cb7', 'cb8']],
        ['Elements of plant biology and ecology', ['b30', 'b32', 'cb5', 'cb4', 'cb20', 'cb19']],
        ['Elements of animal anatomy and physiology', ['b33', 'cb16']]
      ],
      chem: [
        ['Macroscopic properties of matter', ['c1']],
        ['Microscopic properties of matter and composition of substances', ['c2', 'c7', 'c10.1', 'c8.2']],
        ['Periodic trends and atomic structure', ['c6a', 'c6b']],
        ['Chemical reactions and stoichiometry', ['c4', 'c3', 'c3.2', 'c4.5']],
        ['Thermodynamics and kinetics', ['c9', 'c5', 'c16', 'c13', 'c12']],
        ['Compounds and solutions', ['c11', 'c18']],
        ['Acids and bases', ['c14']],
        ['Oxidation and reduction (redox)', ['c17']],
        ['Organic chemistry', ['c20']],
        ['Applied chemistry', ['capp']]
      ],
      phys: [
        ['Physical quantities and measurement', ['p1', 'at5.8', 'p5.1', 'up2.4']],
        ['Point particle kinematics', ['p2', 'p6']],
        ['Point particle dynamics, energy and work', ['p4.1', 'p7.2', 'p9']],
        ['Fluid mechanics and thermodynamics', ['cp11', 'cp12', 'cp13.3', 'p11.1', 'p12.1']],
        ['Electromagnetism principles', ['p18', 'p19', 'p20', 'p13', 'p14.1', 'p15']]
      ]
    },
    tud: {
      math: [
        ['Functions and graphs', ['at3.1', 'at3.4', 'at5.2', 'at6.1', 'at6.3', 'at3.2', 'at3.3', 'at3.5', 'at3.6', 'at4.1', 'at5.1', 'at5.6', 'at6.2', 'at6.4', 'c1-2.2', 'c1-4.6', 'at3.7']],
        ['Algebraic solving', ['at1.4', 'at1.6', 'at2.7', 'at2.6', 'at6.5', 'at6.6', 'at1.5', 'at2.5', 'at11.1', 'at11.3']],
        ['Differential calculus', ['c1-3.1', 'c1-3.3', 'c1-3.5', 'c1-3.6', 'c1-3.9', 'c1-4.3', 'c1-4.5', 'c1-4.7', 'c1-3.4']],
        ['Integral calculus', ['c1-4.10', 'c1-5.2', 'c1-5.4', 'c1-5.5', 'c1-6.1', 'c1-6.2', 'c1-6.3', 'c1-6.4']],
        ['Trigonometry', ['at7.2', 'at7.3', 'at7.4', 'at7.1', 'at8.1', 'at9.5', 'at9.1', 'at9.2', 'at9.3']],
        ['Geometry', ['cm10', 'at10.1', 'at10.2', 'ka-circle', 'at2.1']],
        ['Vectors', ['at10.8', 'c3-2.1', 'c3-2.3', 'c3-3.1', 'c3-3.4', 'c3-2.5', 'c3-1.1', 'at10.6', 'c1-6.6']]
      ],
      phys: [
        ['Fundamentals', ['p1', 'p5.1', 'cp11', 'cp13.3']],
        ['Mechanics', ['p2', 'p4.1', 'p4.4', 'p7.2', 'cp5.1', 'p5.4', 'cp7.4', 'p9', 'p9.3', 'p6', 'p7.1']],
        ['Electricity and magnetic fields', ['p18', 'p19', 'p19.2', 'cp21.3', 'p19.4', 'p20', 'p20.3', 'cp22.4']],
        ['Vibrations and waves', ['cp16.7', 'p5.5', 'p13', 'p13.3', 'p14.1', 'p15']]
      ],
      fy: [
        ['Aerospace structures and materials', ['fy-s5.1', 'fy-s5.2', 'fy-s5.3', 'fy-s5.4', 'fy-s5.5', 'fy-s5.6', 'fy-s5.7', 'fy-s5.8', 'fy-s5.9']],
        ['Aerodynamics', ['fy-a3', 'fy-b1']],
        ['Flight mechanics', ['fy-c1', 'fy-l11']],
        ['Space', ['fy-l4', 'fy-l5']]
      ]
    }
  };
  // sec.syl = [{ n, name, see, rows: [{ x: item, b: book key, num: "2.3" }] }]; items not placed land in "Other" at the end
  ['cents', 'tud'].forEach(function (x) {
    EXAMS[x].sections.forEach(function (sec) {
      var where = {}, used = {};
      sec.books.forEach(function (g) { g.items.forEach(function (it) { where[it[0]] = { x: it, b: g.b }; }); });
      var blocks = (SYL[x] && SYL[x][sec.id]) || [];
      sec.syl = blocks.map(function (bl, i) {
        var rows = [];
        bl[1].forEach(function (id) {
          if (!where[id]) throw new Error('Syllabus item ' + id + ' not in ' + x + '/' + sec.id);
          if (used[id]) throw new Error('Syllabus item ' + id + ' placed twice in ' + x + '/' + sec.id);
          used[id] = true;
          rows.push({ x: where[id].x, b: where[id].b, num: (i + 1) + '.' + (rows.length + 1) });
        });
        return { n: i + 1, name: bl[0], see: bl[2] || '', rows: rows };
      });
      var rest = Object.keys(where).filter(function (id) { return !used[id]; });
      if (rest.length) {
        var n = sec.syl.length + 1;
        sec.syl.push({ n: n, name: 'Other', see: '', rows: rest.map(function (id, j) { return { x: where[id].x, b: where[id].b, num: n + '.' + (j + 1) }; }) });
      }
    });
  });
  function examsOf(itemId) { var c = CAT[itemId]; return c ? c.exams.slice() : []; }
  function itemOfEtut(etutId) {
    var m = /^(cents|tud)-(.+)$/.exec(etutId || '');
    if (!m) return null;
    var c = CAT[m[2]];
    return c && c.pfx === m[1] + '-' ? m[2] : null;
  }
  function examsOfEtut(etutId) { var id = itemOfEtut(etutId); return id ? examsOf(id) : []; }
  function examLabel(itemId) { return examsOf(itemId).map(function (x) { return EXAMS[x].long; }).join(' and '); }

  var ORDER = DATA.map(function (d) { return d.id; });
  function nPages(r) { var n = 0; for (var i = 0; i < r.length; i++) n += r[i][1] - r[i][0] + 1; return n; }
  function printedText(bk, ranges) {
    return ranges.map(function (a) { return (a[0] - (bk.off || 0)) + '\u2013' + (a[1] - (bk.off || 0)); }).join(', ');
  }
  function pdfText(ranges) { return ranges.map(function (a) { return a[0] + '\u2013' + a[1]; }).join(', '); }
  function pagesOf(ranges) { var out = []; ranges.forEach(function (a) { for (var p = a[0]; p <= a[1]; p++) out.push(p); }); return out; }
  function find(itemId) {
    var c = CAT[itemId];
    if (!c) return null;
    return { section: c.section, group: null, book: BOOKS[c.b], item: c.item, exams: c.exams.slice() };
  }
  function etutId(itemId) { var c = CAT[itemId]; return (c ? c.pfx : 'cents-') + itemId; }
  function titlePrefix(itemId) { return examsOf(itemId).map(function (x) { return EXAMS[x].name; }).join(' / '); }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function placeAt(correct, wrong, seed) {
    var pos = hash(seed) % 4, opts = wrong.slice(0, 3);
    opts.splice(pos, 0, correct);
    return { options: opts, correct: pos };
  }

  // A reading study for one syllabus item: read the PDF range, free recall, then two locator questions.
  // Content questions are not generated here (the package has no text of the book); the locator questions are a
  // placeholder so the study can run and be rated like any other.
  function buildPackage(itemId) {
    var f = find(itemId);
    if (!f || !f.item[4].length) return null;
    var it = f.item, code = it[1], title = it[2], ranges = it[4], bk = f.book;
    var pp = pagesOf(ranges), n = pp.length;
    var printed = printedText(bk, ranges), pdf = pdfText(ranges);
    var label = code + ' ' + title;
    var a0 = ranges[0][0] - (bk.off || 0), len = ranges[0][1] - ranges[0][0], wrongRanges = [], shifts = [37, 83, -29, 121, 19, -53];
    for (var si = 0; si < shifts.length && wrongRanges.length < 3; si++) {
      var st0 = a0 + shifts[si];
      if (st0 < 1 || st0 === a0) continue;
      wrongRanges.push(st0 + '\u2013' + (st0 + len));
    }
    var q1 = placeAt('pp. ' + printed, wrongRanges.map(function (t) { return 'pp. ' + t; }), itemId + 'q1');
    var otherBooks = Object.keys(BOOKS).filter(function (k) { return BOOKS[k] !== bk; }).map(function (k) { return BOOKS[k].name; });
    var rot = hash(itemId) % otherBooks.length, wrongBooks = [];
    for (var i = 0; i < 3; i++) wrongBooks.push(otherBooks[(rot + i) % otherBooks.length]);
    var q2 = placeAt(bk.name, wrongBooks, itemId + 'q2');
    var where = bk.name + ', printed pp. ' + printed + ' (PDF pp. ' + pdf + ')';
    var k1 = {
      kazanim_id: 'k1', kind: 'kavram', title: title,
      objective: 'Without notes, explain the main ideas of ' + label + ' in your own words and give one example or worked case from the pages.',
      slides: pp,
      blocks: [
        { type: 'text', md: '**Read ' + where + '.** This study covers the pages of the section ' + label + ' of the CEnT-S syllabus (' + f.section.name + ').', slides: pp.slice(0, 1) },
        { type: 'keypoints', title: 'How to read this range', items: [
          'Skim the headings and the boxed definitions first, then read in order.',
          'Write down every definition, formula and rule in your own words as you go.',
          'Do at least two worked examples or exercises from these pages without looking at the solution.',
          'When you finish, close the book and go on to the recall step.'
        ] }
      ],
      recall: {
        prompt: 'Close the book. What does ' + label + ' cover? Write the main definitions, rules or formulas and one example.',
        model_answer: 'Open ' + where + ' and compare your answer with the headings, boxed definitions and examples there. Add what you missed.',
        key_points: ['Definitions and notation', 'Rules, formulas or procedures', 'One worked example from the pages']
      }
    };
    return {
      etut_id: etutId(itemId), title: 'CEnT-S: ' + label + ' (' + bk.name + ')', version: 1,
      created_at: new Date().toISOString().slice(0, 10), generated: 'cents-reading', cents_item: itemId,
      source: { file: bk.name + ', printed pp. ' + printed + ' (PDF pp. ' + pdf + ')', type: 'pdf', slide_count: n, unit: 'page', url: bk.pdf || bk.url || '' },
      parts: [{
        part_id: 'p1', title: title, slides: pp, kazanimlar: [k1],
        quiz: [
          { q_id: 'q1', kazanim_id: 'k1', level: 'basic', stem: 'Locator check. On which printed pages of ' + bk.name + ' is *' + label + '*?', options: q1.options, correct: q1.correct,
            solution: 'Printed pp. ' + printed + ' (PDF pp. ' + pdf + '). This is a placeholder question; ask Claude to write content questions for these pages.' }
        ]
      }],
      final_test: [
        { q_id: 'f1', kazanim_id: 'k1', level: 'basic', stem: 'Locator check. Which book covers *' + label + '*?', options: q2.options, correct: q2.correct,
          solution: bk.name + ', printed pp. ' + printed + '. This is a placeholder question; ask Claude to write content questions for these pages.' }
      ]
    };
  }

  function extractDir() { return global.KConfig.join('sources') + '\\'; }

  // The prompt that asks Claude Code (opened in the Kartotek folder) to write the real study for one item.
  // Generation options chosen on the Overview page (depth, difficulty): extra lines for every prompt
  var DEPTH = {
    cram: 'Depth: CRAM. Keep only what the exam needs: the core definitions, formulas and rules, one worked example per objective, 1 part if the pages allow, a 4-question quiz.',
    standard: '',
    comprehensive: 'Depth: COMPREHENSIVE. Cover every definition, rule, worked example and exercise type on the pages; split into more parts rather than leaving anything out.'
  };
  // Study v2 keeps an exhaustive outcome ledger, so "cram" narrows the scope openly instead of thinning the coverage
  var DEPTH_V2 = {
    cram: 'Depth: CRAM. Mark the units the exam does not need as out_of_scope with the reason "cram depth" (they appear in the gaps); teach only the core definitions, formulas and rules, one worked example per objective, 1 part if the pages allow. The items and the final test still cover every criterion of the outcomes you keep.',
    standard: '',
    comprehensive: DEPTH.comprehensive
  };
  function levelLine(itemId, v2) {
    var ex = examsOf(itemId), cents = ex.indexOf('cents') >= 0;
    var fmt = cents ? 'CEnT-S (CISIA): short application questions, 5 options in the real exam, one correct' : 'the TU Delft AE selection exam: syllabus-style calculations and concept questions';
    return v2
      ? 'Difficulty: EXAM LEVEL. Write the Applying and final items as application and transfer questions at the level of ' + fmt + (cents ? ' (Study v2 single-answer items may use 5 options like the exam).' : '.')
      : 'Difficulty: EXAM LEVEL. Write the quiz, final test and test items as application and transfer questions at the level of ' + fmt + ' (Kartotek items still use 4 options).';
  }
  function optLines(opts, itemId, v2) {
    opts = opts || {};
    var out = [], D = v2 ? DEPTH_V2 : DEPTH;
    if (D[opts.depth]) out.push(D[opts.depth]);
    if (opts.level === 'exam') out.push(levelLine(itemId, v2));
    return out.length ? [''].concat(out) : [];
  }
  function studyPrompt(itemId, opts) {
    var f = find(itemId);
    if (!f || !f.item[4].length) return null;
    var it = f.item, bk = f.book, id = etutId(itemId), ranges = it[4];
    var pdfRange = pdfText(ranges), label = it[1] + ' ' + it[2];
    return [
      'Write a Kartotek study (Study v2, the cycle workflow) for ' + examLabel(itemId) + ': ' + label + ' (' + f.section.name + ').',
      'Source: ' + bk.name + ' (OpenStax), printed pages ' + printedText(bk, ranges) + ', PDF pages ' + pdfRange + '.',
      'Page extract (only these pages), already on this computer: ' + extractDir() + id + '.pdf',
      '',
      '1. Read ' + extractDir() + id + '.pdf (use the pdf-reading skill; the file is on this computer, open it directly, do not download anything). Page 1 of the extract is PDF page ' + ranges[0][0] + ' of the book; the extract keeps the book order. Only if that file is missing, create it first with: python tools/make-cents-pdfs.py ' + id + ' (needs pip install pypdf; it downloads the book once into tools/cache). Never open the full book PDF, it is too large.',
      '2. Read STUDY-RULES.md in this folder, section "Study v2", and follow it exactly (PRIMING-RULES.md is retired). studies/sample-cycle-v2/etut.json is a complete small example of the format; for a book source use source.unit = "page" and slides = PDF page numbers (an earlier book study in studies/ shows the format).',
      '3. Write studies/' + id + '/source.md (source manifest and unit inventory) and studies/' + id + '/etut.json with "schema_version": 2, "workflow": "cycle-v2", etut_id "' + id + '" and title "' + titlePrefix(itemId) + ': ' + label + ' (' + bk.name + ')". Use real content from those pages only: units and relations, the outcome ledger with success criteria, each part’s orientation and summary, then for every topic (objective) its own short Priming, lesson with source refs, recall card and Feynman prompt (the learner runs one cycle per topic), Applying items per topic (the book exercises first, checked against the book key where it exists), connecting items for questions that need several topics (integrates) and each part’s connect block, a final test built from the complete criterion blueprint, and the gaps. All text in English.',
      '4. Run python tools/audit-study.py studies/' + id + ' until it reports 0 blockers (tell me the warnings you leave), then run build.ps1 so the study is bundled into Kartotek-DSR.html.',
      '5. Keep the same etut_id: a study with this id may already exist in my app (a skeleton or an older v1 study). It updates in place, and its objective cards keep their review history when you keep their kazanim_id values.'
    ].concat(optLines(opts, itemId, true), ['', 'Reply to me in English when it is done.']).join('\n');
  }

  // TU Delft first-year AE items have no page ranges: the study is written from the book section or the lecture page.
  // x[5] = lecture page URL, "dle" = only on the Digital Learning Environment; book sections use the book URL.
  function srcOf(itemId) {
    var f = find(itemId);
    if (!f || f.item[4].length) return null;
    var it = f.item, s = it[5];
    if (s === 'dle') return { kind: 'dle', url: '' };
    if (s) return { kind: 'video', url: s };
    if (f.book.url) return { kind: 'book', url: f.book.url };
    return null;
  }
  function srcPrompt(itemId, opts) {
    var f = find(itemId), src = srcOf(itemId);
    if (!f || !src) return null;
    var it = f.item, bk = f.book, id = etutId(itemId), label = it[1] + ' ' + it[2];
    var read = src.kind === 'book'
      ? ['Source: ' + bk.name + ', section ' + it[1] + ' ' + it[2] + '. Book page: ' + src.url,
         '',
         '1. Look for the book PDF at tools\\cache\\open-books\\alderliesten-aerospace-structures.pdf. If it is missing, download it from the book page into that folder; if you cannot, stop and ask me to download it. Read only section ' + it[1] + ' (pdf-reading skill). References to sections, figures or equations outside chapter 5 are not needed.']
      : src.kind === 'video'
        ? ['Source: TU Delft video lecture "' + label + '", lecture page ' + src.url + ' (TU Delft OpenCourseWare). Every video on that page is exam material.',
           '',
           '1. Open the lecture page and read what it offers (video titles, transcripts, slides, linked readings). If you cannot get the content of the videos, stop and ask me to paste my notes or the transcripts in this chat, and wait for them.']
        : ['Source: TU Delft video lecture "' + label + '". It is only on the Digital Learning Environment (TU Delft selection platform), so you cannot open it.',
           '',
           '1. Ask me to paste my notes or the transcripts of every video of this lecture in this chat, and wait for them before writing anything.'];
    return [
      'Write a Kartotek study (Study v2, the cycle workflow) for the TU Delft AE selection exam: ' + label + ' (' + f.section.name + ').'
    ].concat(read, [
      '2. Read STUDY-RULES.md in this folder, section "Study v2", and follow it exactly. studies/sample-cycle-v2/etut.json is a complete small example of the format.',
      '3. Write studies/' + id + '/source.md and studies/' + id + '/etut.json with "schema_version": 2, "workflow": "cycle-v2", etut_id "' + id + '" and title "TU Delft AE: ' + label + '". Use real content from that source only. The v2027 syllabus says candidates must know every formula in the study material by heart, including the assumptions it rests on, and be able to work with it: give every formula its own recall card (formula, symbols with units, assumptions) and at least one Applying item that uses it. All text in English.',
      '4. Run python tools/audit-study.py studies/' + id + ' until it reports 0 blockers (tell me the warnings you leave), then run build.ps1 so the study is bundled into Kartotek-DSR.html.',
      '5. Keep the same etut_id, so a study with this id updates in place.'
    ], optLines(opts, itemId, true), ['', 'Reply to me in English when it is done.']).join('\n');
  }

  // The end-of-lesson test of one item lives in lessons/<lessonId>/lesson.json (End-of-Lesson Test tab)
  function lessonId(itemId) { return etutId(itemId) + '-test'; }

  // The prompt that asks Claude Code to write the end-of-lesson test for one item (same flow as studyPrompt).
  function lessonPrompt(itemId, opts) {
    var f = find(itemId);
    if (!f || !f.item[4].length) return null;
    var it = f.item, bk = f.book, id = etutId(itemId), lid = lessonId(itemId), ranges = it[4];
    var label = it[1] + ' ' + it[2];
    return [
      'Write a Kartotek end-of-lesson test for ' + examLabel(itemId) + ': ' + label + ' (' + f.section.name + ').',
      'Source: ' + bk.name + ' (OpenStax), printed pages ' + printedText(bk, ranges) + ', PDF pages ' + pdfText(ranges) + '. Treat these pages as the lesson material.',
      'Page extract (only these pages), already on this computer: ' + extractDir() + id + '.pdf',
      '',
      '1. Read ' + extractDir() + id + '.pdf (use the pdf-reading skill; the file is on this computer, open it directly, do not download anything). Page 1 of the extract is PDF page ' + ranges[0][0] + ' of the book; the extract keeps the book order. Only if that file is missing, create it first with: python tools/make-cents-pdfs.py ' + id + ' (needs pip install pypdf; it downloads the book once into tools/cache). Never open the full book PDF, it is too large.',
      '2. Read LESSON-TEST-RULES.md in this folder (and STUDY-RULES.md where it points to it).',
      '3. Write lessons/' + lid + '/source.md and lessons/' + lid + '/lesson.json with lesson_id "' + lid + '" and title "' + titlePrefix(itemId) + ': ' + label + ' (' + bk.name + ') · test". Use real content from those pages only: objectives with write-from-memory recall items, multiple-choice test items and retest items, taken from the book exercises where possible, with every answer checked. All text in English.',
      '4. Validate it with KLesson.validateLesson, then run build.ps1 so the test is bundled into Kartotek-DSR.html.',
      '5. Keep the same lesson_id, so a test with this id updates in place.'
    ].concat(optLines(opts, itemId), ['', 'Reply to me in English when it is done.']).join('\n');
  }

  // ------------------------------------------------------------------ batch, placement, mock and "ask" prompts
  function extractOf(itemId) { return extractDir() + etutId(itemId) + '.pdf'; }
  function itemLine(itemId, num) {
    var f = find(itemId), it = f.item, bk = f.book;
    return '- ' + (num ? num + ' ' : '') + it[2] + ' · ' + bk.name + ' ' + it[1] + ', printed pp. ' + printedText(bk, it[4]) + ' (PDF ' + pdfText(it[4]) + ') · extract ' + extractOf(itemId) + ' · etut_id ' + etutId(itemId) + ' · lesson_id ' + lessonId(itemId);
  }
  var MAKE_EXTRACT = 'If an extract file is missing, create it first with: python tools/make-cents-pdfs.py <etut_id> (needs pip install pypdf). Never open a full book PDF, it is too large.';

  // Several studies (or tests) in one Claude Code session: the next N topics in syllabus order
  function batchPrompt(rows, kind, opts) {
    var test = kind === 'test';
    var lines = [
      'Write ' + rows.length + ' Kartotek ' + (test ? 'end-of-lesson tests' : 'studies (etut)') + ', one after the other, for these syllabus topics (in this order):',
      ''
    ].concat(rows.map(function (r) { return itemLine(r.id, r.num); }), [
      '',
      'For each topic: read only its page extract (pdf-reading skill; the files are on this computer, open them directly). ' + MAKE_EXTRACT,
      test
        ? 'Follow LESSON-TEST-RULES.md and write lessons/<lesson_id>/source.md and lessons/<lesson_id>/lesson.json with the lesson_id given above; validate each with KLesson.validateLesson.'
        : 'Follow STUDY-RULES.md, section "Study v2" (PRIMING-RULES.md is retired): write studies/<etut_id>/source.md and studies/<etut_id>/etut.json ("schema_version": 2, "workflow": "cycle-v2") with the etut_id given above; studies/sample-cycle-v2/etut.json is the format example. Run python tools/audit-study.py studies/<etut_id> for each until it reports 0 blockers.',
      'Use real content from each topic\'s pages only. All text in English. Keep the given ids so existing items update in place.',
      'Run build.ps1 once at the end, after all of them are written.'
    ]);
    var o = opts || {}, D = test ? DEPTH : DEPTH_V2;
    if (D[o.depth]) lines.push('', D[o.depth]);
    if (o.level === 'exam' && rows.length) lines.push(levelLine(rows[0].id, !test));
    lines.push('', 'Reply to me in English with a short list of what was written.');
    return lines.join('\n');
  }

  // Placement (diagnostic) test for one syllabus block: a lesson-test package whose objective ids are the syllabus item ids
  function placementId(exam, secId, n) { return 'place-' + exam + '-' + secId + '-' + n; }
  function placementPrompt(exam, sec, block) {
    var lid = placementId(exam, sec.id, block.n);
    var rows = block.rows.filter(function (r) { return r.x[4].length; });
    return [
      'Write a Kartotek placement test (diagnostic) for ' + EXAMS[exam].long + ', ' + sec.name + ', syllabus block ' + block.n + ' "' + block.name + '".',
      'It tells me which topics I already know, so I can skip them. Topics (one objective each, objective_id = the id in brackets):',
      ''
    ].concat(rows.map(function (r) { return '- [' + r.x[0] + '] ' + r.num + ' ' + r.x[2] + ' · ' + BOOKS[r.b].name + ' pp. ' + printedText(BOOKS[r.b], r.x[4]) + ' · extract ' + extractOf(r.x[0]); }), [
      '',
      'Read each extract (pdf-reading skill, files on this computer). ' + MAKE_EXTRACT,
      'Follow the "Placement tests" section of LESSON-TEST-RULES.md: write lessons/' + lid + '/lesson.json with lesson_id "' + lid + '", title "Placement: ' + EXAMS[exam].name + ' ' + sec.name + ' ' + block.n + ' ' + block.name + '", "placement": {"exam": "' + exam + '", "section": "' + sec.id + '", "block": ' + block.n + '}, one part, one objective per topic with objective_id exactly the id in brackets, a short recall item and 2 test items each (no retest pool needed), questions answerable without having studied the pages only if the topic is really known.',
      'Validate with KLesson.validateLesson, then run build.ps1.',
      '',
      'Reply to me in English when it is done.'
    ]).join('\n');
  }

  // Mock exam in the real format (MOCK-RULES.md); n = the number of this mock, prev = ids of earlier mocks (avoid repeating their questions)
  function mockId(exam, n) { return exam + '-mock-' + n; }
  function mockPrompt(exam, n, prev, past) {
    var mid = mockId(exam, n), secs = EXAMS[exam].sections;
    var lines = [
      past
        ? 'Turn an official past or sample paper of ' + EXAMS[exam].long + ' into a Kartotek mock exam. I will attach the paper (PDF) in this chat; transcribe it exactly as written (questions, options, correct answers when given, section order and timing).'
        : 'Write a new Kartotek mock exam for ' + EXAMS[exam].long + ' in the real exam format.',
      '',
      'Follow MOCK-RULES.md in this folder. Write mocks/' + mid + '/mock.json with mock_id "' + mid + '", exam "' + exam + '", kind "' + (past ? 'past_paper' : 'generated') + '".',
      'Sections, in this order (questions / minutes):'
    ];
    secs.forEach(function (s) {
      lines.push('- ' + s.id + ' · ' + s.name + ': ' + s.q + ' questions / ' + s.min + ' min');
    });
    if (!past) {
      lines.push('', 'Draw the questions from these syllabus topics (item_id in brackets; tag every question with its item_id). Read only the page extracts you need (pdf-reading skill, files on this computer). ' + MAKE_EXTRACT);
      secs.forEach(function (s) {
        var ids = [];
        (s.syl || []).forEach(function (bl) { bl.rows.forEach(function (r) { if (r.x[3] !== 'opt') ids.push('[' + r.x[0] + '] ' + r.x[2]); }); });
        lines.push(s.name + ': ' + ids.join('; '));
      });
      if (prev && prev.length) lines.push('', 'Do not reuse questions from the earlier mocks: ' + prev.map(function (p) { return 'mocks/' + p + '/mock.json'; }).join(', ') + '.');
    }
    lines.push('', 'Validate with KMock.validateMock (node, src/mock-core.js), then run build.ps1.', '', 'Reply to me in English when it is done.');
    return lines.join('\n');
  }

  // Ask Claude about one card, with its source pages
  function askPrompt(c) {
    var lines = ['Explain this Kartotek card to me. Do not change any files.', '', 'Card front: ' + c.front, 'Card back: ' + c.back];
    if (c.explanation) lines.push('Explanation on the card: ' + c.explanation);
    if (c.itemId) {
      var f = find(c.itemId);
      if (f && f.item[4].length) {
        lines.push('', 'Source: ' + f.book.name + ', ' + f.item[1] + ' ' + f.item[2] + ', printed pp. ' + printedText(f.book, f.item[4]) + '. Page extract on this computer: ' + extractOf(c.itemId) + (c.extractPage ? ' (start at its page ' + c.extractPage + ')' : '') + '. Read it with the pdf-reading skill and explain from those pages.');
      }
    }
    lines.push('', 'Explain why the answer is right in a few short paragraphs, point out the usual mistake, then give me one new practice question with its answer hidden at the end. Reply in English.');
    return lines.join('\n');
  }

  global.KCents = { EXAMS: EXAMS, TUD: TUD, TUD_ORDER: TUD.map(function (d) { return d.id; }), examsOf: examsOf, examsOfEtut: examsOfEtut, itemOfEtut: itemOfEtut, examLabel: examLabel, SECTIONS: DATA, BOOKS: BOOKS, ORDER: ORDER, nPages: nPages, printedText: printedText, pdfText: pdfText, etutId: etutId, buildPackage: buildPackage, studyPrompt: studyPrompt, find: find, lessonId: lessonId, lessonPrompt: lessonPrompt,
    batchPrompt: batchPrompt, placementId: placementId, placementPrompt: placementPrompt, mockId: mockId, mockPrompt: mockPrompt, askPrompt: askPrompt, extractOf: extractOf, extractDir: extractDir, srcOf: srcOf, srcPrompt: srcPrompt };
})(typeof window !== 'undefined' ? window : globalThis);
