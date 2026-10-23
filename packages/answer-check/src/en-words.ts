// A compact list of common English words, used only to stop English typo
// tolerance from accepting a *different real word* (ship → shop, hate → have,
// dessert → desert). It does not need to be complete: a word missing here
// just falls back to plain length-based typo tolerance. Lowercase, base forms;
// simple inflections are recognized by `isKnownEnglishWord`.
//
// Hand-curated (no external source, no license encumbrance). Emphasis on short
// and mid-length words, which are where one-edit collisions happen, plus the
// classic confusable pairs.

const WORDS = `
a able about above accept access accident account ache acid acre across act action active actor actual
adapt add address adopt adult advance advice advise affair affect afford afraid after again age agent ago agree
ahead aid aim air alarm album alike alive all allow ally alone along aloud already also alter always amaze amount
amuse anger angel angle angry animal ankle annoy answer ant any apart appeal appear apple apply approve area argue
arise arm army around arrive arrow art article ash aside ask asleep aunt avoid awake award aware away awful
baby back bad badge bag bake balance ball ban band bang bank bar bare bark barn base basic basin basket bat bath
bathe battle bay beach beam bean bear beard beast beat beauty become bed bee beef beer before beg begin behave
behind being belief believe bell belong below belt bench bend beneath bent beside best bet better between beyond
bid big bike bill bind bird birth bit bite bitter black blade blame bland blank blast bleed blend bless blind
block blood bloom blow blue blunt board boast boat body boil bold bolt bomb bond bone book boom boost boot border
bore born borrow boss both bother bottle bottom bounce bound bow bowl box boy brain brake branch brand brave
bread break breast breath breathe breed breeze brick bride bridge brief bright bring broad broke brother brown
brush bubble bucket bud build bulb bulk bull bullet bump bunch burden burn burst bury bus bush business busy
butter button buy cab cabin cable cage cake call calm camp can canal cancel candle cane cap cape capital captain
car card care career cargo carpet carry cart case cash cast castle cat catch cause cave cease ceiling cell cent
center chain chair chalk chance change chapter charge charm chart chase cheap cheat check cheek cheer cheese
chest chew chief child chin chip choice choose chop church circle cite city civil claim clap class clause claw
clay clean clear clerk clever click cliff climb cling clip clock close cloth clothe cloud clown club clue coach
coal coast coat code coin cold collar collect color comb come comfort command comment common company compare
complain complement complete compliment concern confirm connect conscience conscious contain content control
cook cool cope copy cord core corn corner correct cost cottage cotton couch cough could council counsel count
country couple courage course court cousin cover cow crack craft crash crawl crazy cream create credit crew crime
crisp crop cross crowd crown crude cruel crush cry cup cure curious curl current curse curve custom cut cute
dad daily damage damp dance danger dare dark data date daughter dawn day dead deaf deal dear death debate debt
decade decay deceive decide decline deed deep deer defeat defend define degree delay delight deliver demand
deny depend depth describe desert deserve design desire desk despair dessert detail device devil diary die diet
differ dig dine dinner dip direct dirt dirty dish dismiss display distant dive divide doctor dog doll door dose
dot double doubt down dozen draft drag drain draw drawer dream dress drift drill drink drive drop drown drug drum
dry duck due dull dumb dump dust duty each eager ear early earn earth ease east easy eat edge edit effect effort
egg eight either elbow elder elect else empty end enemy energy engine enjoy enough enter entire entry equal error
escape essay even event ever every evil exact exam except excess excuse exist exit expand expect expert explain
export express extent extra eye fabric face fact factor fade fail faint fair faith fake fall false fame family
fan fancy far fare farm fast fat fate father fault favor fear feast feather fee feed feel fellow female fence
fever few field fierce fight figure file fill film final find fine finger finish fire firm first fish fist fit
five fix flag flame flash flat flavor flee fleet flesh flight float flock flood floor flour flow flower fly focus
fog fold folk follow fond food fool foot force forest forget forgive fork form formal former fort fortune
forward found four frame free freeze fresh friend fright frog from front frost fruit fry fuel full fun fund
funny fur future gain game gap garden gas gate gather gaze gear general gentle ghost gift girl give glad glance
glass globe glory glove glow glue goal goat god gold golf good govern grab grace grade grain grand grant grape
grasp grass grave gray great greed green greet grief grin grind grip ground group grow growth guard guess guest
guide guilt gun habit hair half hall halt hand handle hang happen happy harbor hard harm hat hate have hay head
heal health heap hear heart heat heaven heavy heel height hell hello help hen herb here hero hide high hill hint
hip hire hit hold hole holy home honest honey honor hook hope horn horse host hot hotel hour house huge human
humor hunger hunt hurry hurt idea idle ill image impact import imply inch income index inner insect inside
insist invite iron issue item jacket jail jam jar jaw jeans jewel job join joint joke journey joy judge juice
jump junior jury just keen keep key kick kid kill kind king kiss kitchen knee knife knock knot know label labor
lack lady lake lamb lamp land lane large last late later laugh launch law lawn lay layer lazy lead leaf lean leap
learn least leather leave left leg legal lemon lend length lens less lesson let letter level liar lid lie life
lift light like limb limit line link lion lip liquid list listen little live load loan local lock lodge log lone
long look loose lord lose loss lost lot loud love low loyal luck lump lunch lung machine mad magic maid mail main
major make male man manage manner many map march mark market marry mask mass master match mate matter may meal
mean measure meat medal media meet melt member memory mend mental menu mercy mere merit mess metal method middle
might mild mile milk mill mind mine minor mint minute mirror miss mist mix mode model moist mold mom moment money
monk month mood moon moral more morning most moth mother motion motor mount mouse mouth move much mud murder
muscle music must myth nail naked name narrow nation native nature navy near neat neck need needle nerve nest net
never new news next nice night nine noble nod noise none noon nor normal north nose note notice novel now number
nurse nut oak obey object occur ocean odd offer office often oil old once one onion only open oppose order organ
other ought ounce out oven over owe own owner pace pack page pain paint pair pale palm pan panel panic paper
parade pardon parent park part party pass past paste pat patch path patient pause pave pavement paw pay payment
peace peak pear pearl peel peer pen pencil people pepper per perfect period permit person pet phone photo piano
pick picture pie piece pig pile pill pin pine pink pint pipe pit pity place plain plan plane plant plate play
plead please pledge plenty plot plug plus pocket poem poet point poison pole police polish polite pool poor pop
port pose post pot potato pound pour powder power praise pray preach present press pretty prey price pride
priest prince principal principle print prison private prize probe profit prompt proof proper proud prove
public pull pump punch pupil pure purse push put quarter queen query quest quick quiet quit quite quote race rack
radio rage raid rail rain raise range rank rare rat rate rather raw reach read ready real realm reason rebel
recall record red reduce refer reform refuse region reign reject relax release relief rely remain remark remind
remove rent repair repeat reply report rescue resign resist resort rest result retire return reveal review
reward rice rich rid ride right ring riot rise risk rival river road roar rob rock rod role roll roof room root
rope rose rot rough round route row royal rub rude rug ruin rule run rush sack sad safe sail saint sake salad
sale salt same sand save saw say scale scar scare scene scent school scope score scream screen sea seal search
season seat second secret see seed seek seem seize self sell send senior sense sentence serve set settle seven
shade shadow shake shall shallow shame shape share sharp shave she shed sheep sheet shelf shell shelter shift
shine ship shirt shock shoe shoot shop shore short shot should shout show shower shut shy sick side sigh sight
sign silent silk silly silver simple sin since sing single sink sir sister sit site six size skill skin skirt
sky slap slave sleep slice slide slight slim slip slope slow small smart smell smile smoke smooth snake snap snow
soap social sock soft soil soldier sole solid solve some son song soon sore sorrow sorry sort soul sound soup
sour south space spare speak spear speech speed spell spend spill spin spirit spit spite split spoil spoon sport
spot spray spread spring spy square stable staff stage stain stair stake stale stamp stand star stare start
starve state station stationary stationery stay steady steal steam steel steep steer stem step stick stiff
still sting stir stock stomach stone stool stop store storm story stove straight strange straw stream street
stress stretch strict strike string strip stroke strong study stuff stupid style subject suck sudden suffer
sugar suit sum summer sun super supply sure surface swallow swear sweat sweep sweet swell swim swing sword table
tail take tale talent talk tall tank tap tape target task taste tax tea teach team tear tease teeth tell temper
tend tender tense tent term test text than thank that theme then theory there thick thief thin thing think third
thirst those though thread threat three throat throne through throw thumb tick ticket tide tidy tie tiger tight
till time tin tiny tip tire title toast today toe together toilet tomb tone tongue tonight tool tooth top topic
torch total touch tough tour towel tower town toy trace track trade trail train trap travel tray treat tree
tremble trend trial tribe trick trip troop trouble truck true trust truth try tube tune turn twin twist type ugly
uncle under union unit unite until upper upset urge use usual vain valley value van vary vast verse very vessel
victim view village virtue visit voice volume vote wage wait wake walk wall wander want war warm warn wash waste
watch water wave wax way weak wealth weapon wear weather weave wed weed week weep weigh weight welcome well west
wet what wheat wheel when where whether which while whip whisper white whole why wicked wide widow width wife
wild will win wind window wine wing winter wipe wire wise wish wit with within witness wolf woman wonder wood
wool word work world worm worry worse worth would wound wrap wreck wrist write wrong yard yawn year yell yellow
yes yet yield young youth zero zone
began begun bit bought broke broken brought built came caught chose dealt did done drank drew driven drove ate
eaten fell felt fled flew forgot fought found froze gave given gone got grew held hid hung kept knew known laid
led left lent lit lost made meant met paid ran rang rode rose said sang sank sat saw seen sent shook shot sold
spent spoke stole stood stuck struck swam swore taken taught thought threw told took tore torn understood went
woke won wore worn wove wrote men women children feet mice geese
`;

const SET: ReadonlySet<string> = new Set(WORDS.split(/\s+/).filter((w) => w !== ''));

/** Lemma candidates for a lowercase word: itself plus simple inflection stems. */
function lemmas(w: string): string[] {
  const out = [w];
  const strip = (suf: string, add = ''): void => {
    if (w.length > suf.length + 2 && w.endsWith(suf)) out.push(w.slice(0, -suf.length) + add);
  };
  strip('s'); strip('es'); strip('ies', 'y');
  strip('d'); strip('ed'); strip('ied', 'y');
  strip('ing'); strip('ing', 'e');
  strip('ly'); strip('er'); strip('est'); strip('r'); strip('st');
  // Doubled consonant before -ed/-ing: stopped → stop, shipping → ship.
  const dbl = /^(.*?)([b-df-hj-np-tv-z])\2(?:ed|ing)$/.exec(w);
  if (dbl) out.push((dbl[1] as string) + (dbl[2] as string));
  return out;
}

/** Is `w` (lowercase, one word) a common English word or a simple inflection of one? */
export function isKnownEnglishWord(w: string, extra?: ReadonlySet<string>): boolean {
  return lemmas(w).some((l) => SET.has(l) || (extra?.has(l) ?? false));
}
