"""
Generates src/assets/content/{poses,exercises,decks}.json.

All exercise descriptions, cues and figures are original to this project.
Exercise *names* are standard, generic movement names.

Run:  python3 tools/build_content.py
"""
import json, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "src" / "assets" / "content"

# ---------------------------------------------------------------------------
# Pose library. Side view, figure faces right, 100x100 box, ground at y=90.
# Joints: head, neck, hip, nE/nH (near elbow/hand), fE/fH (far), nK/nF, fK/fF.
# Far limbs default to the near limb when omitted.
# ---------------------------------------------------------------------------
def P(head, neck, hip, nE, nH, nK, nF, fE=None, fH=None, fK=None, fF=None):
    return dict(head=head, neck=neck, hip=hip, nE=nE, nH=nH, nK=nK, nF=nF,
                fE=fE or nE, fH=fH or nH, fK=fK or nK, fF=fF or nF)

STAND_LEGS = dict(nK=[51, 71], nF=[52, 90], fK=[49, 71], fF=[48, 90])
def stand(nE, nH, fE=None, fH=None, **legs):
    l = {**STAND_LEGS, **legs}
    return P([50, 13], [50, 23], [50, 52], nE, nH, l["nK"], l["nF"], fE, fH, l["fK"], l["fF"])

HINGE = dict(head=[76, 38], neck=[67, 41], hip=[40, 50], nK=[45, 70], nF=[42, 90], fK=[43, 70], fF=[40, 90])
def hinge(nE, nH, fE=None, fH=None):
    h = HINGE
    return P(h["head"], h["neck"], h["hip"], nE, nH, h["nK"], h["nF"], fE, fH, h["fK"], h["fF"])

SQUAT = dict(head=[57, 33], neck=[55, 43], hip=[37, 64], nK=[59, 66], nF=[53, 90], fK=[57, 65], fF=[50, 90])
def squat(nE, nH, fE=None, fH=None):
    s = SQUAT
    return P(s["head"], s["neck"], s["hip"], nE, nH, s["nK"], s["nF"], fE, fH, s["fK"], s["fF"])

LUNGE = dict(head=[48, 25], neck=[48, 35], hip=[48, 61], nK=[65, 72], nF=[66, 90], fK=[40, 87], fF=[26, 89])
def lunge(nE, nH, fE=None, fH=None):
    s = LUNGE
    return P(s["head"], s["neck"], s["hip"], nE, nH, s["nK"], s["nF"], fE, fH, s["fK"], s["fF"])

SUPINE = dict(head=[16, 84], neck=[25, 86], hip=[51, 86], nK=[63, 70], nF=[73, 90])
def supine(nE, nH, fE=None, fH=None, **o):
    s = {**SUPINE, **o}
    return P(s["head"], s["neck"], s["hip"], nE, nH, s["nK"], s["nF"], fE, fH, s.get("fK"), s.get("fF"))

PRONE = dict(neck=[66, 86], head=[75, 84], hip=[44, 88], nK=[28, 89], nF=[13, 89])
def prone(nE, nH, **o):
    s = {**PRONE, **o}
    return P(s["head"], s["neck"], s["hip"], nE, nH, s["nK"], s["nF"])

LEAN_BACK = dict(nF=[74, 90], nK=[65, 74], hip=[56, 57], neck=[41, 29], head=[36, 21])

POSES = {
    # standing family
    "stand":          stand([51, 38], [52, 52], [49, 38], [48, 52]),
    "stand-rack":     stand([57, 36], [56, 26]),
    "stand-overhead": stand([55, 13], [56, 2]),
    "stand-front":    stand([62, 25], [75, 25]),
    "stand-curl":     stand([51, 38], [61, 28]),
    "stand-upright":  stand([58, 25], [54, 31]),
    "stand-bar":      stand([44, 31], [50, 24]),
    "stand-halo":     stand([58, 20], [48, 10]),
    "stand-chest":    stand([46, 34], [58, 30]),
    "stand-rowback":  stand([39, 36], [50, 38]),
    "stand-pushdown": stand([47, 36], [57, 50]),
    "stand-quad":     stand([51, 38], [52, 52], [45, 38], [40, 56], fK=[48, 72], fF=[37, 58]),
    "stand-tricep":   stand([56, 6], [46, 20]),
    "stand-crossbody": stand([62, 30], [44, 28]),
    "stand-doorway":  stand([42, 24], [34, 14]),
    "stand-knee":     stand([60, 38], [58, 30], [44, 38], [38, 30], nK=[66, 52], nF=[64, 70]),
    "stand-kick":     stand([58, 38], [60, 30], [42, 38], [40, 46], fK=[46, 72], fF=[34, 58]),
    "stand-hug":      stand([62, 42], [62, 54], nK=[64, 52], nF=[60, 68]),
    "stand-calfraise": P([50, 9], [50, 19], [50, 48], [51, 34], [52, 48], [51, 67], [53, 86], fK=[49, 67], fF=[49, 86]),
    "stand-swingfwd": stand([52, 38], [54, 50], [44, 34], [38, 30], nK=[64, 66], nF=[74, 76]),
    "stand-tree":     stand([55, 13], [52, 3], fK=[60, 62], fF=[50, 56]),
    "stand-wallcalf": P([58, 16], [56, 26], [46, 54], [66, 30], [76, 24], [56, 72], [60, 90], fK=[38, 72], fF=[30, 90]),
    # squat family
    "squat":          squat([67, 46], [79, 46]),
    "squat-rack":     squat([60, 50], [60, 40]),
    "squat-bar":      squat([48, 38], [55, 34]),
    "squat-hands":    squat([60, 56], [62, 68]),
    "chair":          squat([63, 30], [70, 18]),
    "wall-sit":       P([36, 14], [36, 25], [36, 54], [38, 40], [40, 54], [58, 55], [58, 90]),
    # lunge family
    "lunge":          lunge([44, 48], [50, 60], [52, 48], [50, 60]),
    "lunge-hang":     lunge([48, 50], [48, 64]),
    "lunge-bar":      lunge([42, 33], [48, 27]),
    "lunge-overhead": lunge([52, 15], [53, 4]),
    "warrior2":       lunge([62, 35], [78, 35], [34, 35], [18, 35]),
    "kneel-lunge":    P([50, 32], [50, 42], [46, 68], [50, 56], [56, 68], [64, 76], [66, 90], fK=[42, 90], fF=[24, 90]),
    # hinge family
    "hinge":          hinge([66, 56], [66, 70]),
    "hinge-low":      P([74, 50], [66, 52], [38, 60], [64, 68], [62, 82], [52, 74], [44, 90], fK=[50, 74], fF=[42, 90]),
    "hinge-row":      hinge([54, 40], [62, 54]),
    "hinge-front":    hinge([74, 48], [84, 44]),
    "hinge-upright":  hinge([56, 42], [66, 48]),
    "hinge-fold":     P([72, 72], [66, 63], [44, 50], [68, 75], [67, 87], [47, 70], [46, 90]),
    "hinge-bar":      P([74, 38], [67, 41], [40, 50], [60, 36], [64, 42], [45, 70], [42, 90]),
    # floor
    "plank-high":     P([80, 67], [72, 69], [46, 77], [72, 80], [72, 90], [30, 82], [14, 88]),
    "plank-low":      P([80, 81], [72, 82], [46, 85], [62, 76], [72, 90], [30, 87], [14, 89]),
    "plank-forearm":  P([78, 67], [70, 69], [44, 75], [70, 89], [84, 89], [28, 81], [12, 87]),
    "mountain":       P([80, 66], [72, 68], [46, 74], [72, 80], [72, 90], [60, 80], [50, 86], fK=[30, 82], fF=[14, 88]),
    "pike-high":      P([72, 76], [68, 68], [46, 40], [74, 80], [80, 90], [36, 64], [26, 90]),
    "pike-low":       P([72, 84], [68, 80], [46, 44], [60, 76], [80, 90], [36, 66], [26, 90]),
    "supine":         supine([34, 81], [44, 86]),
    "crunch":         P([30, 66], [34, 75], [51, 86], [30, 66], [40, 60], [63, 70], [73, 90]),
    "crunch-reach":   P([32, 64], [36, 74], [51, 86], [48, 70], [58, 68], [63, 70], [73, 90]),
    "bridge":         P([16, 86], [25, 86], [49, 70], [34, 88], [44, 88], [63, 63], [72, 90]),
    "bridge-1leg":    P([16, 86], [25, 86], [49, 70], [34, 88], [44, 88], [63, 63], [72, 90], fK=[66, 56], fF=[82, 44]),
    "supine-press-bottom": supine([32, 90], [33, 76]),
    "supine-press-top":    supine([32, 76], [33, 62]),
    "supine-kneehug":  P([16, 84], [25, 86], [51, 86], [40, 78], [52, 68], [50, 64], [36, 62], fK=[69, 84], fF=[88, 88]),
    "supine-twist":   P([16, 84], [25, 86], [51, 86], [26, 74], [22, 62], [62, 76], [56, 90]),
    "deadbug":        P([16, 84], [25, 86], [51, 86], [26, 74], [28, 62], [52, 70], [64, 70], fE=[20, 74], fH=[10, 72], fK=[64, 82], fF=[82, 84]),
    "prone":          prone([74, 90], [84, 90]),
    "superman":       P([72, 80], [64, 84], [44, 90], [76, 80], [88, 76], [28, 88], [13, 84]),
    "prone-y":        P([72, 82], [64, 86], [44, 90], [72, 82], [82, 78], [28, 89], [13, 89]),
    "prone-angel":    P([72, 82], [64, 86], [44, 90], [56, 82], [46, 80], [28, 89], [13, 89]),
    "cobra":          P([72, 60], [66, 68], [44, 88], [66, 80], [68, 90], [28, 90], [13, 90]),
    "child":          P([68, 84], [58, 80], [34, 80], [74, 90], [88, 90], [50, 90], [30, 90]),
    "puppy":          P([66, 86], [58, 82], [44, 64], [72, 90], [86, 90], [44, 90], [24, 90]),
    "tabletop":       P([72, 54], [66, 60], [42, 60], [66, 75], [66, 90], [42, 90], [22, 90]),
    "cow":            P([74, 50], [66, 60], [42, 60], [66, 75], [66, 90], [42, 90], [22, 90], ),
    "cat":            P([70, 68], [66, 58], [42, 58], [66, 75], [66, 90], [42, 90], [22, 90]),
    "kneel-tall":     P([52, 32], [50, 42], [44, 66], [54, 64], [58, 84], [44, 90], [24, 90]),
    "rollout":        P([72, 68], [64, 70], [44, 80], [76, 76], [86, 84], [30, 90], [12, 90]),
    "downdog":        P([70, 76], [66, 68], [46, 40], [74, 80], [80, 90], [36, 64], [26, 90]),
    "seated-fold":    P([66, 70], [58, 72], [30, 86], [66, 82], [78, 84], [56, 86], [78, 88]),
    "seated-v":       P([62, 54], [58, 62], [40, 86], [64, 74], [72, 70], [56, 72], [70, 78]),
    "boat":           P([56, 50], [52, 60], [40, 86], [62, 64], [72, 66], [56, 70], [72, 58]),
    "hands-shoulder": stand([54, 36], [52, 26], [46, 36], [48, 26]),
    # jump / run
    "jump":           P([50, 6], [50, 16], [50, 44], [58, 8], [62, 0], [54, 60], [50, 76], [42, 8], [38, 0], [46, 60], [44, 76]),
    "run":            P([55, 13], [53, 23], [48, 50], [60, 38], [67, 30], [62, 62], [58, 77], [41, 40], [37, 52], [43, 70], [32, 85]),
    "sprint":         P([62, 16], [58, 26], [46, 50], [66, 36], [72, 26], [62, 58], [62, 74], [44, 42], [36, 54], [40, 70], [26, 80]),
    "a-skip":         P([52, 10], [51, 20], [49, 48], [44, 36], [38, 28], [66, 48], [64, 66], [60, 36], [66, 28], [50, 68], [52, 86]),
    # suspension
    "lean-back":      P(LEAN_BACK["head"], LEAN_BACK["neck"], LEAN_BACK["hip"], [50, 21], [62, 14], LEAN_BACK["nK"], LEAN_BACK["nF"]),
    "lean-row":       P([44, 20], [48, 28], [58, 57], [40, 20], [56, 14], [66, 74], [74, 90]),
    "lean-y":         P([36, 21], [41, 29], [56, 57], [46, 16], [52, 4], [65, 74], [74, 90]),
    "lean-curl":      P([44, 20], [48, 28], [58, 57], [58, 22], [52, 16], [66, 74], [74, 90]),
    "lean-fwd":       P([62, 22], [58, 30], [44, 58], [70, 28], [78, 22], [36, 74], [30, 90]),
    "lean-fwd-low":   P([72, 30], [67, 38], [46, 60], [60, 22], [80, 22], [37, 75], [30, 90]),
    "lean-tricep":    P([70, 30], [66, 38], [46, 60], [80, 24], [70, 18], [37, 75], [30, 90]),
    "hang-squat":     squat([62, 30], [70, 18]),
    "hang-lunge":     lunge([58, 30], [66, 18]),
    "strap-plank":    P([80, 70], [72, 72], [46, 66], [72, 81], [72, 90], [30, 62], [16, 58]),
    "strap-tuck":     P([80, 64], [72, 66], [50, 60], [72, 78], [72, 90], [58, 72], [44, 62]),
    "strap-pike":     P([76, 78], [70, 72], [50, 40], [72, 81], [72, 90], [38, 50], [26, 56]),
    "strap-curl-start": P([16, 86], [25, 86], [50, 82], [34, 88], [44, 88], [64, 80], [78, 74]),
    "strap-curl-end":   P([16, 86], [25, 86], [48, 72], [34, 88], [44, 88], [62, 58], [62, 74]),
    "strap-pushup":   P([80, 76], [72, 78], [46, 76], [64, 70], [72, 90], [30, 70], [16, 66]),
    # ball
    "ball-crunch-start": P([22, 58], [30, 54], [50, 62], [34, 44], [36, 52], [64, 66], [66, 90]),
    "ball-crunch-end":   P([32, 44], [36, 50], [50, 62], [34, 42], [42, 38], [64, 66], [66, 90]),
    "ball-ext-start":  P([66, 78], [58, 70], [40, 52], [62, 76], [64, 88], [26, 70], [14, 90]),
    "ball-ext-end":    P([70, 46], [62, 52], [40, 52], [62, 46], [70, 40], [26, 70], [14, 90]),
    "ball-y":          P([70, 48], [62, 54], [40, 52], [72, 46], [82, 40], [26, 70], [14, 90]),
    "ball-incline":    P([76, 44], [68, 48], [44, 66], [72, 60], [72, 70], [28, 78], [14, 88]),
    "ball-incline-low": P([80, 52], [72, 56], [46, 70], [62, 50], [72, 70], [30, 80], [14, 88]),
    "ball-decline":    P([80, 76], [72, 78], [48, 70], [72, 84], [72, 90], [32, 64], [18, 60]),
    "ball-decline-low": P([80, 86], [72, 86], [48, 76], [64, 76], [72, 90], [32, 66], [18, 60]),
    "ball-pike":       P([76, 80], [70, 76], [50, 48], [72, 84], [72, 90], [40, 56], [30, 60]),
    "ball-plank":      P([76, 58], [68, 60], [44, 72], [60, 68], [72, 68], [28, 80], [12, 88]),
    "ball-pass-start": P([16, 84], [25, 86], [51, 86], [18, 76], [8, 70], [66, 86], [84, 88]),
    "ball-pass-end":   P([30, 70], [34, 78], [51, 86], [44, 62], [54, 54], [62, 68], [62, 52]),
    "ball-hamcurl-start": P([16, 86], [25, 86], [50, 78], [34, 88], [44, 88], [64, 76], [78, 72]),
    "ball-hamcurl-end":   P([16, 86], [25, 86], [48, 66], [34, 88], [44, 88], [62, 52], [66, 68]),
    "ball-bridge-start":  P([16, 86], [25, 86], [48, 84], [34, 88], [44, 88], [60, 70], [74, 70]),
    "ball-bridge-end":    P([16, 86], [25, 86], [48, 70], [34, 88], [44, 88], [62, 64], [74, 70]),
    "ball-wall-start":    stand([56, 36], [62, 46]),
    "ball-wall-end":      squat([67, 46], [79, 46]),
}

# ---------------------------------------------------------------------------
# Exercises: (id, name, description, [cues], muscle, measure, difficulty,
#             poseStart, poseEnd, prop)
# prop: None | {"type": "dumbbell"|"kettlebell"|"barbell"} (drawn at hands)
#       | {"type": "band", "anchor": "feet"|"front"|"behind"|"above"}
#       | {"type": "ball", "x":, "y":, "r":}
#       | {"type": "strap", "attach": "hands"|"feet"}
# ---------------------------------------------------------------------------
LEGS, PUSH, PULL, CORE = "legs", "push", "pull", "core"

def E(i, n, d, c, g, m, lv, a, b=None, prop=None):
    return dict(id=i, name=n, description=d, cues=c, group=g, measure=m,
                difficulty=lv, poseStart=a, poseEnd=b or a, prop=prop)

DB, KB, BB = {"type": "dumbbell"}, {"type": "kettlebell"}, {"type": "barbell"}
def band(anchor): return {"type": "band", "anchor": anchor}
def ball(x, y, r=13): return {"type": "ball", "x": x, "y": y, "r": r}
def strap(attach="hands", anchorX=None):
    d = {"type": "strap", "attach": attach}
    if anchorX is not None: d["anchorX"] = anchorX
    return d

CATEGORIES = {
 "bodyweight": dict(label="Bodyweight", equipment="none", suits="strength", ex=[
  E("bw-air-squat", "Air Squat", "Sit your hips back and down until thighs are level, then stand tall.", ["Heels stay down", "Knees track over toes"], LEGS, "reps", 1, "stand", "squat"),
  E("bw-reverse-lunge", "Reverse Lunge", "Step one foot back and lower until both knees bend near 90°, then return.", ["Torso upright", "Alternate legs"], LEGS, "reps", 2, "stand", "lunge"),
  E("bw-jump-squat", "Jump Squat", "Drop into a squat and drive up into a jump, landing softly back into the squat.", ["Land quietly", "Arms drive up"], LEGS, "reps", 3, "squat", "jump"),
  E("bw-push-up", "Push-Up", "From a high plank, lower your chest toward the floor and press back up.", ["Body in one line", "Elbows about 45°"], PUSH, "reps", 2, "plank-high", "plank-low"),
  E("bw-wide-push-up", "Wide Push-Up", "A push-up with hands set wider than shoulders to load the chest more.", ["Brace your core", "Full range"], PUSH, "reps", 2, "plank-high", "plank-low"),
  E("bw-pike-push-up", "Pike Push-Up", "With hips high, bend the elbows to bring your head toward the floor, then press up.", ["Hips stay stacked", "Head between hands"], PUSH, "reps", 3, "pike-high", "pike-low"),
  E("bw-superman", "Superman", "Lying face down, lift arms, chest, and legs off the floor together.", ["Squeeze glutes", "Neck neutral"], PULL, "reps", 1, "prone", "superman"),
  E("bw-prone-y", "Prone Y-Raise", "Face down with arms in a Y, lift the arms by squeezing the shoulder blades.", ["Thumbs up", "Slow lower"], PULL, "reps", 1, "prone", "prone-y"),
  E("bw-snow-angel", "Reverse Snow Angel", "Face down, sweep straight arms from overhead to your hips without touching the floor.", ["Arms hover", "Shoulders down"], PULL, "reps", 2, "prone-y", "prone-angel"),
  E("bw-crunch", "Crunch", "On your back with knees bent, curl your shoulders off the floor and lower slowly.", ["Chin off chest", "Exhale up"], CORE, "reps", 1, "supine", "crunch"),
  E("bw-plank", "Forearm Plank", "Hold a straight line from head to heels on your forearms.", ["Ribs down", "Don't let hips sag"], CORE, "seconds", 2, "plank-forearm"),
  E("bw-mountain-climber", "Mountain Climber", "From a high plank, drive knees toward the chest one at a time at pace.", ["Hips low", "Shoulders over hands"], CORE, "reps", 3, "plank-high", "mountain"),
 ]),
 "dumbbell": dict(label="Dumbbell", equipment="dumbbell", suits="strength", ex=[
  E("db-goblet-squat", "Goblet Squat", "Hold one dumbbell at your chest and squat between your knees.", ["Elbows inside knees", "Chest proud"], LEGS, "reps", 2, "stand-rack", "squat-rack", DB),
  E("db-rdl", "Dumbbell Romanian Deadlift", "With soft knees, push the hips back and lower the weights along your legs, then stand.", ["Flat back", "Weights close"], LEGS, "reps", 2, "stand", "hinge", DB),
  E("db-reverse-lunge", "Dumbbell Reverse Lunge", "Hold weights at your sides and step back into a lunge.", ["Front heel planted", "Control the drop"], LEGS, "reps", 3, "stand", "lunge-hang", DB),
  E("db-floor-press", "Floor Press", "Lying on your back, press the dumbbells from chest height to straight arms.", ["Elbows touch lightly", "Wrists stacked"], PUSH, "reps", 1, "supine-press-bottom", "supine-press-top", DB),
  E("db-overhead-press", "Overhead Press", "From shoulder height, press the dumbbells straight overhead.", ["Ribs down", "Biceps by ears at top"], PUSH, "reps", 2, "stand-rack", "stand-overhead", DB),
  E("db-front-raise", "Front Raise", "Lift straight arms forward to shoulder height and lower slowly.", ["No swinging", "Slight elbow bend"], PUSH, "reps", 1, "stand", "stand-front", DB),
  E("db-bent-row", "Bent-Over Row", "Hinge forward and pull the dumbbells toward your hips.", ["Lead with elbows", "Pause at top"], PULL, "reps", 2, "hinge", "hinge-row", DB),
  E("db-curl", "Biceps Curl", "Keeping elbows at your sides, curl the weights to your shoulders.", ["Elbows still", "Slow lower"], PULL, "reps", 1, "stand", "stand-curl", DB),
  E("db-upright-row", "Upright Row", "Pull the dumbbells up along your body to chest height, elbows leading.", ["Elbows higher than hands", "Stop at chest"], PULL, "reps", 2, "stand", "stand-upright", DB),
  E("db-russian-twist", "Russian Twist", "Seated and leaning back, rotate a dumbbell from hip to hip.", ["Chest tall", "Move from the ribs"], CORE, "reps", 2, "seated-v", None, DB),
  E("db-weighted-crunch", "Weighted Crunch", "Hold a dumbbell at your chest and crunch up.", ["Weight stays close", "Exhale up"], CORE, "reps", 2, "supine", "crunch", DB),
  E("db-suitcase-hold", "Suitcase Hold", "Stand tall holding a heavy dumbbell in one hand without leaning.", ["Level shoulders", "Switch sides halfway"], CORE, "seconds", 1, "stand", None, DB),
 ]),
 "kettlebell": dict(label="Kettlebell", equipment="kettlebell", suits="strength", ex=[
  E("kb-swing", "Kettlebell Swing", "Hinge and hike the bell back, then snap the hips forward to float it to chest height.", ["Hips drive it", "Arms just guide"], LEGS, "reps", 3, "hinge", "stand-front", KB),
  E("kb-goblet-squat", "Kettlebell Goblet Squat", "Hold the bell by the horns at your chest and squat deep.", ["Heels down", "Sit between hips"], LEGS, "reps", 2, "stand-rack", "squat-rack", KB),
  E("kb-reverse-lunge", "Kettlebell Reverse Lunge", "Carry the bell at your side or chest and step back into a lunge.", ["Upright torso", "Soft knee touch"], LEGS, "reps", 2, "stand", "lunge-hang", KB),
  E("kb-press", "Kettlebell Press", "From the rack position, press the bell overhead and lock out.", ["Wrist straight", "Glutes tight"], PUSH, "reps", 2, "stand-rack", "stand-overhead", KB),
  E("kb-floor-press", "Kettlebell Floor Press", "Lying down, press the bell from chest to straight arm.", ["Bell rests on forearm", "Controlled lower"], PUSH, "reps", 1, "supine-press-bottom", "supine-press-top", KB),
  E("kb-thruster", "Kettlebell Thruster", "Squat with the bell racked, then stand and press it overhead in one motion.", ["Use leg drive", "Finish locked out"], PUSH, "reps", 3, "squat-rack", "stand-overhead", KB),
  E("kb-row", "Single-Arm Row", "Hinged forward, pull the bell to your hip and lower it.", ["Square shoulders", "Pull to pocket"], PULL, "reps", 2, "hinge", "hinge-row", KB),
  E("kb-high-pull", "High Pull", "Hinge, then extend hard and pull the bell up to chest height, elbows high.", ["Hips first", "Elbows lead"], PULL, "reps", 3, "hinge", "hinge-upright", KB),
  E("kb-deadlift", "Kettlebell Deadlift", "With the bell between your feet, hinge down, grip, and stand tall.", ["Flat back", "Push the floor away"], PULL, "reps", 1, "hinge-low", "stand", KB),
  E("kb-russian-twist", "Kettlebell Russian Twist", "Seated with feet down or up, rotate the bell side to side.", ["Slow and even", "Tall spine"], CORE, "reps", 2, "seated-v", None, KB),
  E("kb-halo", "Halo", "Circle the bell around your head, keeping it close.", ["Ribs still", "Change direction"], CORE, "reps", 1, "stand-rack", "stand-halo", KB),
  E("kb-farmer-hold", "Farmer Hold", "Stand or walk tall holding bells at your sides.", ["Shoulders packed", "Breathe steadily"], CORE, "seconds", 1, "stand", None, KB),
 ]),
 "barbell": dict(label="Barbell", equipment="barbell", suits="strength", ex=[
  E("bb-back-squat", "Back Squat", "With the bar across your upper back, squat to depth and stand.", ["Brace before descent", "Knees out"], LEGS, "reps", 3, "stand-bar", "squat-bar", BB),
  E("bb-front-squat", "Front Squat", "Rack the bar on your front shoulders and squat upright.", ["Elbows high", "Stay tall"], LEGS, "reps", 3, "stand-rack", "squat-rack", BB),
  E("bb-lunge", "Barbell Lunge", "With the bar on your back, step back into a lunge and return.", ["Short controlled step", "Steady bar"], LEGS, "reps", 3, "stand-bar", "lunge-bar", BB),
  E("bb-floor-press", "Barbell Floor Press", "Lying down, lower the bar until elbows touch the floor, then press.", ["Tight upper back", "Bar over shoulders"], PUSH, "reps", 2, "supine-press-bottom", "supine-press-top", BB),
  E("bb-overhead-press", "Barbell Overhead Press", "From the front rack, press the bar overhead, moving your head back then through.", ["Squeeze glutes", "Bar path straight"], PUSH, "reps", 2, "stand-rack", "stand-overhead", BB),
  E("bb-push-press", "Push Press", "Dip slightly at the knees, then drive the bar overhead with your legs.", ["Short dip", "Lock out"], PUSH, "reps", 3, "squat-rack", "stand-overhead", BB),
  E("bb-deadlift", "Deadlift", "Grip the bar over mid-foot and stand up by pushing through the floor.", ["Bar touches legs", "Neutral spine"], PULL, "reps", 3, "hinge-low", "stand", BB),
  E("bb-bent-row", "Barbell Row", "Hinged forward, row the bar to your lower ribs.", ["Torso still", "Pause at top"], PULL, "reps", 2, "hinge", "hinge-row", BB),
  E("bb-curl", "Barbell Curl", "Curl the bar from thighs to shoulders with elbows pinned.", ["No hip swing", "Full lower"], PULL, "reps", 1, "stand", "stand-curl", BB),
  E("bb-rollout", "Barbell Rollout", "From your knees, roll the bar forward as far as you can control, then pull back.", ["Ribs tucked", "Short range first"], CORE, "reps", 3, "kneel-tall", "rollout", BB),
  E("bb-good-morning", "Good Morning", "With the bar on your back, hinge forward to near parallel and stand.", ["Light weight", "Soft knees"], CORE, "reps", 2, "stand-bar", "hinge-bar", BB),
  E("bb-hip-thrust", "Hip Thrust", "With the bar across your hips, drive them up until level with your knees.", ["Chin tucked", "Squeeze at top"], CORE, "reps", 2, "supine", "bridge", BB),
 ]),
 "band": dict(label="Resistance band", equipment="band", suits="strength", ex=[
  E("rb-squat", "Banded Squat", "Stand on the band with handles at shoulders and squat.", ["Keep tension", "Even feet"], LEGS, "reps", 1, "stand-rack", "squat-rack", band("feet")),
  E("rb-glute-bridge", "Banded Glute Bridge", "With a loop above the knees, bridge up while pressing the knees out.", ["Knees wide", "Hold at top"], LEGS, "reps", 1, "supine", "bridge", band("knees")),
  E("rb-lateral-walk", "Lateral Band Walk", "In a half squat with a loop around the legs, step sideways without letting the feet meet.", ["Stay low", "Toes forward"], LEGS, "reps", 2, "squat-hands", None, band("knees")),
  E("rb-chest-press", "Band Chest Press", "With the band anchored behind, press both hands forward to straight arms.", ["Split stance", "Slow return"], PUSH, "reps", 1, "stand-chest", "stand-front", band("behind")),
  E("rb-overhead-press", "Band Overhead Press", "Stand on the band and press the handles overhead.", ["Ribs down", "Full lockout"], PUSH, "reps", 2, "stand-rack", "stand-overhead", band("feet")),
  E("rb-pushdown", "Triceps Pushdown", "With the band anchored high, push the hands down until elbows straighten.", ["Elbows pinned", "Pause at bottom"], PUSH, "reps", 1, "stand-chest", "stand-pushdown", band("above")),
  E("rb-row", "Band Row", "With the band anchored in front, pull the handles to your ribs.", ["Squeeze shoulder blades", "Tall chest"], PULL, "reps", 1, "stand-front", "stand-rowback", band("front")),
  E("rb-pull-apart", "Band Pull-Apart", "Hold the band at shoulder height and pull it apart until it touches your chest.", ["Straight arms", "Shoulders down"], PULL, "reps", 1, "stand-front", "stand-crossbody", band("hands")),
  E("rb-curl", "Band Curl", "Stand on the band and curl the handles up.", ["Elbows still", "Resist on the way down"], PULL, "reps", 1, "stand", "stand-curl", band("feet")),
  E("rb-pallof", "Pallof Press", "With the band anchored to your side, press the hands straight out and resist the twist.", ["Hips square", "Hold two counts"], CORE, "reps", 2, "stand-chest", "stand-front", band("front")),
  E("rb-woodchop", "Band Woodchop", "Pull the band diagonally from high to low across your body.", ["Pivot back foot", "Rotate from trunk"], CORE, "reps", 2, "stand-overhead", "squat-hands", band("above")),
  E("rb-dead-bug", "Banded Dead Bug", "On your back holding a band anchored overhead, lower opposite arm and leg.", ["Low back down", "Slow reach"], CORE, "reps", 2, "supine", "deadbug", band("behind")),
 ]),
 "ball": dict(label="Exercise ball", equipment="ball", suits="strength", ex=[
  E("sb-wall-squat", "Ball Wall Squat", "With a ball between your back and a wall, roll down into a squat and up.", ["Feet forward", "Knees over ankles"], LEGS, "reps", 1, "ball-wall-start", "ball-wall-end", ball(28, 54, 10)),
  E("sb-hamstring-curl", "Ball Hamstring Curl", "Heels on the ball and hips lifted, roll the ball toward you and back out.", ["Hips stay up", "Slow out"], LEGS, "reps", 3, "ball-hamcurl-start", "ball-hamcurl-end", ball(80, 78, 11)),
  E("sb-bridge", "Ball Bridge", "Feet on the ball, lift your hips into a straight line.", ["Squeeze glutes", "Steady ball"], LEGS, "reps", 2, "ball-bridge-start", "ball-bridge-end", ball(78, 78, 11)),
  E("sb-incline-push-up", "Incline Ball Push-Up", "Hands on the ball, lower your chest to it and press away.", ["Grip the ball", "Tight core"], PUSH, "reps", 2, "ball-incline", "ball-incline-low", ball(72, 80, 10)),
  E("sb-decline-push-up", "Decline Ball Push-Up", "Shins on the ball and hands on the floor, perform push-ups.", ["Hips level", "Full range"], PUSH, "reps", 3, "ball-decline", "ball-decline-low", ball(22, 72, 11)),
  E("sb-pike", "Ball Pike", "Feet on the ball in a plank, lift your hips high and roll back out.", ["Straight legs", "Shoulders over hands"], PUSH, "reps", 4, "ball-decline", "ball-pike", ball(26, 72, 11)),
  E("sb-back-extension", "Ball Back Extension", "Draped face down over the ball, lift your chest until your body is straight.", ["Feet wide", "No overarching"], PULL, "reps", 1, "ball-ext-start", "ball-ext-end", ball(46, 76, 13)),
  E("sb-y-raise", "Ball Y-Raise", "Face down over the ball, raise your arms into a Y.", ["Thumbs up", "Chest stays down"], PULL, "reps", 1, "ball-ext-end", "ball-y", ball(46, 76, 13)),
  E("sb-superman-hold", "Ball Superman Hold", "Over the ball, hold your chest and arms lifted.", ["Glutes on", "Look at the floor"], PULL, "seconds", 2, "ball-y", None, ball(46, 76, 13)),
  E("sb-crunch", "Ball Crunch", "With your low back on the ball, curl your ribs toward your hips.", ["Feet wide", "Stretch back over"], CORE, "reps", 1, "ball-crunch-start", "ball-crunch-end", ball(46, 76, 13)),
  E("sb-plank", "Ball Plank", "Forearms on the ball, hold a straight plank.", ["Elbows under shoulders", "Stay still"], CORE, "seconds", 2, "ball-plank", None, ball(70, 78, 11)),
  E("sb-pass", "Ball Pass", "Lying on your back, pass the ball from hands to feet and back.", ["Low back down", "Reach long"], CORE, "reps", 3, "ball-pass-start", "ball-pass-end", ball(56, 44, 9)),
 ]),
 "suspension": dict(label="Suspension", equipment="suspension", suits="strength", ex=[
  E("st-squat", "Suspension Squat", "Hold the handles for balance and squat deep.", ["Light grip", "Sit back"], LEGS, "reps", 1, "stand-front", "hang-squat", strap()),
  E("st-lunge", "Suspension Lunge", "Holding the handles, step back into a lunge.", ["Upright", "Use straps lightly"], LEGS, "reps", 1, "stand-front", "hang-lunge", strap()),
  E("st-hamstring-curl", "Suspension Hamstring Curl", "Heels in the cradles, lift your hips and pull heels toward you.", ["Hips high", "Slow extend"], LEGS, "reps", 3, "strap-curl-start", "strap-curl-end", strap("feet")),
  E("st-chest-press", "Suspension Chest Press", "Facing away and leaning forward, lower your chest between the handles and press back.", ["Straight body", "Walk feet back to progress"], PUSH, "reps", 2, "lean-fwd", "lean-fwd-low", strap("hands", 36)),
  E("st-triceps", "Suspension Triceps Extension", "Leaning forward, bend only at the elbows to bring hands by your head, then extend.", ["Elbows fixed", "Tight core"], PUSH, "reps", 2, "lean-fwd", "lean-tricep", strap("hands", 36)),
  E("st-push-up", "Suspension Push-Up", "Feet in the cradles, perform push-ups from the floor.", ["Hips level", "Straps steady"], PUSH, "reps", 3, "strap-plank", "strap-pushup", strap("feet")),
  E("st-row", "Suspension Row", "Lean back with straight arms and pull your chest to the handles.", ["Body stays rigid", "Elbows close"], PULL, "reps", 1, "lean-back", "lean-row", strap()),
  E("st-y-fly", "Suspension Y-Fly", "Leaning back, raise straight arms up into a Y and pull yourself upright.", ["Thumbs up", "Slow return"], PULL, "reps", 2, "lean-back", "lean-y", strap()),
  E("st-curl", "Suspension Biceps Curl", "Leaning back with palms up, curl your hands toward your forehead.", ["Elbows high", "Straight body"], PULL, "reps", 2, "lean-back", "lean-curl", strap()),
  E("st-plank", "Suspension Plank", "Feet in the cradles, hold a straight high plank.", ["Don't sway", "Push the floor"], CORE, "seconds", 2, "strap-plank", None, strap("feet")),
  E("st-knee-tuck", "Suspension Knee Tuck", "From a strap plank, pull both knees toward your chest.", ["Round the back slightly", "Control out"], CORE, "reps", 3, "strap-plank", "strap-tuck", strap("feet")),
  E("st-pike", "Suspension Pike", "From a strap plank, lift your hips high with straight legs.", ["Shoulders stay over hands", "Slow lower"], CORE, "reps", 4, "strap-plank", "strap-pike", strap("feet")),
 ]),
 "flexibility": dict(label="Flexibility", equipment="none", suits="flexibility", ex=[
  E("fx-quad", "Standing Quad Stretch", "Hold one ankle behind you and bring the knee under your hip.", ["Tuck the pelvis", "Switch halfway"], LEGS, "seconds", 1, "stand-quad"),
  E("fx-hamstring", "Seated Hamstring Stretch", "Sit with legs long and fold forward from the hips.", ["Lead with the chest", "Breathe out to deepen"], LEGS, "seconds", 1, "seated-fold"),
  E("fx-hip-flexor", "Kneeling Hip Flexor Stretch", "In a half kneel, shift your hips forward until the front of the back hip opens.", ["Squeeze back glute", "Stay tall"], LEGS, "seconds", 1, "kneel-lunge"),
  E("fx-cat-cow", "Cat-Cow", "On hands and knees, alternate rounding and arching your spine.", ["Move with breath", "Slow tempo"], PULL, "reps", 1, "cat", "cow"),
  E("fx-knee-hug", "Knee-to-Chest", "On your back, hug one knee toward your chest.", ["Other leg long", "Relax shoulders"], PULL, "seconds", 1, "supine-kneehug"),
  E("fx-supine-twist", "Supine Twist", "On your back, let both knees fall to one side and look the other way.", ["Shoulders heavy", "Switch halfway"], PULL, "seconds", 1, "supine-twist"),
  E("fx-cross-body", "Cross-Body Shoulder Stretch", "Pull one straight arm across your chest.", ["Shoulder down", "Switch halfway"], PUSH, "seconds", 1, "stand-crossbody"),
  E("fx-triceps", "Overhead Triceps Stretch", "Reach one hand down your back and ease the elbow back with the other hand.", ["Ribs down", "Gentle pressure"], PUSH, "seconds", 1, "stand-tricep"),
  E("fx-doorway", "Doorway Chest Stretch", "With forearm on a doorframe, step through until the chest opens.", ["Elbow at shoulder height", "Small step"], PUSH, "seconds", 1, "stand-doorway"),
  E("fx-wall-calf", "Wall Calf Stretch", "Hands on a wall, step one foot back and press the heel down.", ["Back knee straight", "Toes forward"], CORE, "seconds", 1, "stand-wallcalf"),
  E("fx-toe-reach", "Standing Toe Reach", "Fold forward from the hips and let your hands hang toward your feet.", ["Soft knees", "Heavy head"], CORE, "seconds", 1, "hinge-fold"),
  E("fx-leg-swing", "Front Leg Swing", "Holding support, swing one leg forward and back in a relaxed arc.", ["Tall torso", "Grow the range"], CORE, "reps", 1, "stand", "stand-swingfwd"),
 ]),
 "yoga": dict(label="Yoga", equipment="mat", suits="flexibility", ex=[
  E("yg-warrior-2", "Warrior II", "Wide lunge with the front knee bent and arms reaching long both ways.", ["Front knee over ankle", "Gaze over front hand"], LEGS, "seconds", 2, "warrior2"),
  E("yg-low-lunge", "Low Lunge", "Back knee down, sink the hips forward and lift the arms.", ["Front knee stacked", "Lift the chest"], LEGS, "seconds", 1, "kneel-lunge"),
  E("yg-chair", "Chair Pose", "Sit the hips back with arms raised as if lowering onto a chair.", ["Weight in heels", "Long spine"], LEGS, "seconds", 2, "chair"),
  E("yg-cobra", "Cobra", "Face down, press lightly through the hands to lift the chest.", ["Elbows bent", "Legs active"], PULL, "seconds", 1, "prone", "cobra"),
  E("yg-child", "Child's Pose", "Kneel, sit back toward your heels, and rest the forehead down with arms long.", ["Breathe into the back", "Knees wide if needed"], PULL, "seconds", 1, "child"),
  E("yg-bridge", "Bridge Pose", "On your back, press through the feet to lift the hips.", ["Knees over ankles", "Chin away from chest"], PULL, "seconds", 2, "supine", "bridge"),
  E("yg-down-dog", "Downward Dog", "Hands and feet down, lift the hips high to form an inverted V.", ["Press floor away", "Bend knees if needed"], PUSH, "seconds", 2, "downdog"),
  E("yg-upward-salute", "Upward Salute", "Standing tall, sweep the arms overhead.", ["Shoulders soft", "Ribs down"], PUSH, "seconds", 1, "stand", "stand-overhead"),
  E("yg-puppy", "Puppy Pose", "From all fours, walk the hands forward and melt the chest down with hips high.", ["Hips over knees", "Relax the neck"], PUSH, "seconds", 2, "puppy"),
  E("yg-tree", "Tree Pose", "Balance on one leg with the other foot on the inner leg and arms up.", ["Avoid the knee joint", "Fixed gaze"], CORE, "seconds", 2, "stand-tree"),
  E("yg-mountain", "Mountain Pose", "Stand evenly with arms at your sides and a long spine.", ["Weight even", "Soft breath"], CORE, "seconds", 1, "stand"),
  E("yg-boat", "Boat Pose", "Balance on your sit bones with legs lifted and arms forward.", ["Long spine", "Bend knees to start"], CORE, "seconds", 3, "boat"),
 ]),
 "running": dict(label="Running", equipment="none", suits="running", ex=[
  E("rn-high-knees", "High Knees", "Run in place, driving each knee to hip height.", ["Quick feet", "Tall posture"], LEGS, "seconds", 2, "stand", "stand-knee"),
  E("rn-butt-kicks", "Butt Kicks", "Jog lightly, bringing heels toward your glutes.", ["Knees point down", "Relaxed arms"], LEGS, "seconds", 1, "stand", "stand-kick"),
  E("rn-a-skip", "A-Skip", "Skip forward with a rhythmic knee drive and a quick step down.", ["Land under hips", "Opposite arm drive"], LEGS, "reps", 2, "stand", "a-skip"),
  E("rn-calf-raise", "Calf Raise", "Rise onto your toes and lower slowly.", ["Full height", "Three-count lower"], PUSH, "reps", 1, "stand", "stand-calfraise"),
  E("rn-single-leg-bridge", "Single-Leg Bridge", "On your back with one leg lifted, bridge up through the planted foot.", ["Hips level", "Switch legs"], PUSH, "reps", 2, "supine", "bridge-1leg"),
  E("rn-walking-lunge", "Walking Lunge", "Lunge forward, stepping through into the next rep.", ["Upright", "Soft back knee"], PUSH, "reps", 2, "stand", "lunge"),
  E("rn-strides", "Strides", "Accelerate smoothly to fast, relaxed running, then ease off.", ["Stay relaxed", "Walk back to recover"], PULL, "seconds", 2, "run"),
  E("rn-hill-sprint", "Hill Sprint", "Sprint hard up a short hill and walk back down.", ["Drive the arms", "Full recovery"], PULL, "seconds", 4, "sprint"),
  E("rn-easy-jog", "Easy Jog", "Jog at a pace where you could hold a conversation.", ["Short stride", "Breathe easy"], PULL, "seconds", 1, "run"),
  E("rn-leg-swing", "Leg Swings", "Holding support, swing one leg forward and back.", ["Loose hips", "Build range"], CORE, "reps", 1, "stand", "stand-swingfwd"),
  E("rn-knee-hug", "Walking Knee Hug", "Step and pull the opposite knee to your chest, rising onto your toes.", ["Stand tall", "Alternate"], CORE, "reps", 1, "stand", "stand-hug"),
  E("rn-calf-stretch", "Standing Calf Stretch", "Lean into a wall with one heel pressed back.", ["Straight back leg", "Switch halfway"], CORE, "seconds", 1, "stand-wallcalf"),
 ]),
}

SUIT_SETS = {
    "strength": {"hearts": ("Legs", ["legs"]), "diamonds": ("Push", ["chest", "shoulders"]),
                 "clubs": ("Pull", ["back", "arms"]), "spades": ("Core", ["core"])},
    "flexibility": {"hearts": ("Hips & legs", ["legs"]), "diamonds": ("Shoulders & chest", ["shoulders", "chest"]),
                    "clubs": ("Spine", ["back"]), "spades": ("Balance & calves", ["core", "mobility"])},
    "running": {"hearts": ("Drills", ["cardio"]), "diamonds": ("Strength", ["legs"]),
                "clubs": ("Running", ["cardio"]), "spades": ("Mobility", ["mobility"])},
}
GROUP_TO_SUIT = {LEGS: "hearts", PUSH: "diamonds", PULL: "clubs", CORE: "spades"}
SUIT_COLOR = {"hearts": "suit-hearts", "diamonds": "suit-diamonds", "clubs": "suit-clubs", "spades": "suit-spades"}
RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
RANK_VALUE = {"A": 11, "J": 10, "Q": 10, "K": 10, **{str(n): n for n in range(2, 11)}}

def tier(rank):  # which of the suit's 3 exercises a rank uses
    if rank in ("2", "3", "4", "5"): return 0
    if rank in ("6", "7", "8", "9"): return 1
    return 2  # 10, J, Q, K, A


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    exercises, decks = [], []
    for cat_id, cat in CATEGORIES.items():
        suit_labels = SUIT_SETS[cat["suits"]]
        by_suit = {s: [] for s in GROUP_TO_SUIT.values()}
        for e in cat["ex"]:
            for k in ("poseStart", "poseEnd"):
                assert e[k] in POSES, f"{e['id']}: unknown pose {e[k]}"
            suit = GROUP_TO_SUIT[e["group"]]
            by_suit[suit].append(e)
            exercises.append({
                "id": e["id"], "name": e["name"], "description": e["description"],
                "cues": e["cues"], "category": cat_id,
                "muscleGroups": suit_labels[suit][1],
                "equipment": [cat["equipment"]], "difficulty": e["difficulty"],
                "measure": e["measure"],
                "figure": {"start": e["poseStart"], "end": e["poseEnd"], "prop": e["prop"]},
                "builtIn": True,
            })
        cards = []
        for suit, exs in by_suit.items():
            assert len(exs) == 3, f"{cat_id}/{suit} needs 3 exercises, has {len(exs)}"
            exs = sorted(exs, key=lambda x: x["difficulty"])
            for r in RANKS:
                e = exs[tier(r)]
                v = RANK_VALUE[r]
                cards.append({"id": f"{cat_id}-{suit}-{r}", "suit": suit, "rank": r,
                              "exerciseId": e["id"],
                              "baseAmount": v * 5 if e["measure"] == "seconds" else v})
        for j in (1, 2):
            cards.append({"id": f"{cat_id}-joker-{j}", "suit": "joker", "rank": "JOKER",
                          "exerciseId": None, "baseAmount": 0})
        decks.append({
            "id": f"deck-{cat_id}", "name": f"{cat['label']} deck", "category": cat_id,
            "suits": [{"suit": s, "label": l, "color": SUIT_COLOR[s], "muscleGroups": g}
                      for s, (l, g) in suit_labels.items()]
                     + [{"suit": "joker", "label": "Wild", "color": "suit-joker", "muscleGroups": ["full-body"]}],
            "cards": cards, "builtIn": True, "updatedAt": 0,
        })
    (OUT / "poses.json").write_text(json.dumps(POSES, indent=1))
    (OUT / "exercises.json").write_text(json.dumps({"version": 1, "exercises": exercises}, indent=1))
    (OUT / "decks.json").write_text(json.dumps({"version": 1, "decks": decks}, indent=1))
    print(f"{len(POSES)} poses, {len(exercises)} exercises, {len(decks)} decks")


if __name__ == "__main__":
    build()
