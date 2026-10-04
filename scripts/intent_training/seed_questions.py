"""
In-domain training questions for the agriOS intent classifier.

SYNTHETIC: hand-written by the agriOS team (not collected from farmers) in
English and Swahili, phrased the way a smallholder might ask about a scan
result. Swahili needs review by a native speaker. Off-topic examples come from
Amazon MASSIVE (sw-KE, en-US; CC BY 4.0) — see train_intent.py.

None of these strings appear in eval_questions.json (checked by train_intent.py).
"""

SEED = {
    "summary": {
        "en": [
            "what disease does my coffee have", "what is wrong with this leaf", "what am i looking at",
            "can you tell me what this is", "what is this problem called", "is this a disease",
            "what are these spots", "why are the leaves yellow and orange", "what is attacking my coffee",
            "explain this result", "what did the scan find", "is it bad", "how serious is it",
            "is my tree sick", "what are the orange marks", "what are these brown patches",
            "is this a pest or a fungus", "what does this mean", "what kind of sickness is this",
            "describe the problem", "what is the name of this disease", "should i be worried about this",
            "is this dangerous for the harvest", "will it kill my tree", "how bad is this for my yield",
            "what is this on my leaves", "tell me more about it", "what caused these spots",
        ],
        "sw": [
            "kahawa yangu ina ugonjwa gani", "jani hili lina shida gani", "hiki ni nini",
            "niambie hii ni nini", "tatizo hili ni la aina gani", "je huu ni ugonjwa",
            "madoa haya ni nini", "kwa nini majani ni ya njano", "nini kinashambulia kahawa yangu",
            "nieleze matokeo haya", "picha imeonyesha nini", "je ni mbaya sana",
            "ni hatari kiasi gani", "mti wangu ni mgonjwa", "alama hizi za machungwa ni nini",
            "madoa ya kahawia ni nini", "ni wadudu au kuvu", "hii ina maana gani",
            "ni ugonjwa wa aina gani", "nieleze tatizo", "ugonjwa huu unaitwa nani",
            "nina wasiwasi na hii", "itaharibu mavuno yangu", "mti utakufa",
            "mavuno yatapungua kiasi gani", "nini kimeota kwenye majani", "nieleze zaidi",
            "kwa nini majani yana madoa",
        ],
    },
    "doNow": {
        "en": [
            "what should i do first", "what do i do right now", "what is my first step",
            "what can i do today", "should i remove the leaves", "do i cut the branches",
            "should i burn the sick leaves", "can i put the leaves in compost", "what do i do with the branches",
            "how do i start", "what must i do this morning", "should i pull the leaves off",
            "do i throw away the leaves", "what is the next step", "tell me what to do",
            "what action should i take now", "should i cut down the tree", "what to do immediately",
            "how do i handle it today", "should i pick the damaged leaves", "where do i begin",
            "what do i do before spraying", "is there something i should do now", "help me act now",
            "what should i do this week", "do i destroy the infected leaves",
        ],
        "sw": [
            "nifanye nini kwanza", "nifanye nini sasa", "hatua yangu ya kwanza ni ipi",
            "naweza kufanya nini leo", "niondoe majani", "nikate matawi",
            "nichome majani yaliyougua", "niweke majani kwenye mbolea", "nifanye nini na matawi",
            "nianzie wapi", "nifanye nini asubuhi hii", "nichume majani haya",
            "nitupe majani", "hatua inayofuata ni ipi", "niambie nifanye nini",
            "nichukue hatua gani sasa", "nikate mti wote", "nifanye nini mara moja",
            "nishughulikie vipi leo", "nichume majani yaliyoharibika", "naanza vipi",
            "nifanye nini kabla ya kunyunyizia", "kuna kitu nifanye sasa", "nisaidie nichukue hatua",
            "nifanye nini wiki hii", "niangamize majani yaliyoambukizwa",
        ],
    },
    "treatment": {
        "en": [
            "which spray should i use", "what medicine works for this", "is there a cure",
            "how do i treat it", "what chemical do i need", "which fungicide is best",
            "how often should i spray", "how many times do i spray", "when should i spray",
            "how much spray do i mix", "what do i buy at the shop", "can i use copper",
            "does neem work", "which fertilizer should i add", "what do i spray on the leaves",
            "where can i get the spray", "what product kills it", "is there an organic treatment",
            "what pesticide do i need", "do i need medicine", "how do i cure my coffee",
            "what should i apply", "can i use an insecticide", "what do i put on the tree",
            "how long until the spray works", "should i spray again",
        ],
        "sw": [
            "nitumie dawa gani", "dawa gani inafaa kwa hii", "kuna tiba",
            "nitatibu vipi", "nahitaji kemikali gani", "dawa ya kuvu ipi ni bora",
            "ninyunyizie mara ngapi", "ninyunyizie kila baada ya muda gani", "ninyunyizie lini",
            "nichanganye dawa kiasi gani", "ninunue nini dukani", "naweza kutumia shaba",
            "mwarobaini unafanya kazi", "niweke mbolea gani", "ninyunyizie nini kwenye majani",
            "nitapata wapi dawa", "dawa gani inaua", "kuna tiba ya asili",
            "nahitaji dawa ya wadudu ipi", "nahitaji dawa", "nitaponya vipi kahawa yangu",
            "nipake nini", "naweza kutumia dawa ya wadudu", "niweke nini kwenye mti",
            "dawa itachukua muda gani kufanya kazi", "ninyunyizie tena",
        ],
    },
    "prevention": {
        "en": [
            "how do i stop it from coming back", "how can i prevent this", "how do i protect my trees",
            "what stops it next season", "how do i avoid this in future", "how do i keep it away",
            "how can my trees stay healthy", "will pruning help prevent it", "does shade help",
            "how do i make my coffee stronger", "what can i do so it never happens again",
            "how do i protect the young plants", "should i change how i farm", "how do i reduce the risk",
            "what keeps the disease away", "how do i guard my farm", "what can i plant to protect it",
            "how often should i prune to prevent it", "how do i look after the soil", "what prevents it",
            "how do i stop it next year", "can good feeding prevent it",
        ],
        "sw": [
            "nitazuia vipi lisirudi", "naweza kuzuia hii vipi", "nitalinda miti yangu vipi",
            "nini kitazuia msimu ujao", "nitaepuka hii baadaye vipi", "nitaliweka mbali vipi",
            "miti yangu itabaki na afya vipi", "kupogoa kutasaidia kuzuia", "kivuli kinasaidia",
            "nitaimarisha kahawa yangu vipi", "nifanye nini isitokee tena",
            "nitalinda miche vipi", "nibadilishe jinsi ninavyolima", "nitapunguza hatari vipi",
            "nini kinazuia ugonjwa", "nitalinda shamba langu vipi", "nipande nini kulinda",
            "nipogoe mara ngapi kuzuia", "nitatunza udongo vipi", "nini kinazuia",
            "nitazuia vipi mwaka ujao", "kulisha vizuri kunazuia",
        ],
    },
    "spread": {
        "en": [
            "is it contagious", "will it spread", "can it move to other trees",
            "will my neighbours get it", "does the wind carry it", "does rain spread it",
            "can i carry it on my hands", "will the whole farm get sick", "how fast does it spread",
            "can it jump to the next row", "will it infect my other coffee", "does it spread by insects",
            "can it reach the next farm", "how does it travel", "is it catching",
            "will the other plants catch it", "can my tools spread it", "does it spread in the dry season",
            "should i warn my neighbour", "can it go from tree to tree", "does it spread through the soil",
        ],
        "sw": [
            "unaambukiza", "utaenea", "unaweza kuhamia miti mingine",
            "majirani wataupata", "upepo unaubeba", "mvua inaueneza",
            "naweza kuubeba mikononi", "shamba lote litaugua", "unaenea kwa kasi gani",
            "unaweza kuruka mstari unaofuata", "utaambukiza kahawa yangu nyingine", "unaenezwa na wadudu",
            "unaweza kufika shamba jirani", "unasafiri vipi", "unaenea",
            "mimea mingine itaupata", "vifaa vyangu vinaweza kueneza", "unaenea wakati wa kiangazi",
            "nimwonye jirani", "unatoka mti hadi mti", "unaenea kupitia udongo",
        ],
    },
    "safety": {
        "en": [
            "is the spray dangerous", "is it safe to spray", "is it safe for my children",
            "can my goats eat the leaves", "is it poisonous", "do i need gloves",
            "should i wear a mask", "can i eat the beans after spraying", "is the chemical toxic",
            "will it harm my cows", "can i drink the water nearby", "is it safe for bees",
            "how do i protect myself when spraying", "can kids play near the trees", "is it harmful to touch",
            "will the spray make me sick", "is it safe for chickens", "how long before i can harvest after spraying",
            "what should i wear to spray", "can pregnant women spray",
        ],
        "sw": [
            "dawa ni hatari", "ni salama kunyunyizia", "ni salama kwa watoto wangu",
            "mbuzi wanaweza kula majani", "ina sumu", "nahitaji glavu",
            "nivae barakoa", "naweza kula maharage baada ya kunyunyizia", "kemikali ina sumu",
            "itadhuru ng'ombe wangu", "naweza kunywa maji ya karibu", "ni salama kwa nyuki",
            "nitajikinga vipi nikinyunyizia", "watoto wanaweza kucheza karibu na miti", "ni hatari kugusa",
            "dawa itanifanya mgonjwa", "ni salama kwa kuku", "nisubiri muda gani kuvuna baada ya kunyunyizia",
            "nivae nini kunyunyizia", "mama mjamzito anaweza kunyunyizia",
        ],
    },
    "getHelp": {
        "en": [
            "who should i ask", "who can help me", "where do i find an expert",
            "should i call the extension officer", "who do i report this to", "can someone visit my farm",
            "how do i contact the co-op", "is there an agronomist nearby", "who knows about coffee",
            "i need a person to check", "where can i get advice", "who can i talk to",
            "should i tell the cooperative", "how do i reach the officer", "who else can look at it",
            "is there a helpline", "can an expert confirm this", "who do i show this to",
        ],
        "sw": [
            "nimuulize nani", "nani anaweza kunisaidia", "nitapata mtaalamu wapi",
            "nimpigie afisa ugani", "niripoti kwa nani", "kuna mtu anaweza kutembelea shamba",
            "nitawasiliana na chama vipi", "kuna mtaalamu karibu", "nani anajua kuhusu kahawa",
            "nahitaji mtu akague", "nitapata ushauri wapi", "naweza kuongea na nani",
            "niwaambie chama cha ushirika", "nitamfikia afisa vipi", "nani mwingine anaweza kuangalia",
            "kuna nambari ya msaada", "mtaalamu anaweza kuthibitisha", "nimwonyeshe nani",
        ],
    },
    # Domain-adjacent questions the app must NOT answer (MASSIVE adds general off-topic).
    "outOfScope": {
        "en": [
            "what is the coffee price today", "how much will the buyer pay", "when do i sell my beans",
            "how do i grow maize", "my beans have worms", "my cow is coughing", "can i get a loan",
            "what is the weather tomorrow", "when will the rains start", "how do i plant bananas",
            "where is the market", "can i use ddt", "can i spray paraquat", "how much is fertilizer",
            "send money to my daughter", "what time is it", "tell me a joke", "who won the football",
            "how do i fix my phone", "is the school open",
        ],
        "sw": [
            "bei ya kahawa leo ni ngapi", "mnunuzi atalipa kiasi gani", "niuze kahawa lini",
            "nitapanda mahindi vipi", "maharage yangu yana minyoo", "ng'ombe wangu anakohoa", "naweza kupata mkopo",
            "hali ya hewa kesho", "mvua itaanza lini", "nitapanda ndizi vipi",
            "soko liko wapi", "naweza kutumia ddt", "ninyunyizie paraquat", "mbolea inauzwa bei gani",
            "mtumie binti yangu pesa", "ni saa ngapi", "niambie kichekesho", "nani alishinda mpira",
            "nitatengeneza simu yangu vipi", "shule imefunguliwa",
        ],
    },
}

# Disease words, so questions that name the disease still route by what they ask.
DISEASE_WORDS = {
    "en": ["rust", "leaf rust", "leaf miner", "phoma", "brown eye spot", "this disease", "the spots"],
    "sw": ["kutu", "kutu ya majani", "mchimbaji wa majani", "phoma", "doa la jicho", "ugonjwa huu", "madoa haya"],
}
PREFIXES = {
    "en": ["", "", "please ", "hello, ", "excuse me, ", "tell me, "],
    "sw": ["", "", "je, ", "tafadhali ", "habari, ", "naomba kujua, "],
}
SUFFIXES = {
    "en": ["", "", "?", " for {d}", " with {d}", " on my coffee"],
    "sw": ["", "", "?", " kwa {d}", " na {d}", " kwenye kahawa yangu"],
}
