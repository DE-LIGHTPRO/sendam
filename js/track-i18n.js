// The family's page in English, Yorùbá and Nigerian Pidgin.
//
// The Yorùbá and Pidgin were written by the project's AI assistant and are to be proofread by
// a native speaker before any real launch. Every sentence the page shows is in this one file,
// so correcting a translation means changing a line here and nothing else.
//
// The meter screen (WAITING, PAID, ACCEPT) stays in English on purpose: it shows what a real
// prepaid meter shows.

const hoursMinutes = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  return { d: Math.floor(m / 1440), h: Math.floor(m / 60), m: m % 60, total: m };
};

export const LANGS = [['en', 'English'], ['yo', 'Yorùbá'], ['pcm', 'Pidgin']];

export const TEXT = {
  en: {
    eyebrow: 'Sendam · for your home',
    title: 'Electricity for <em>your home</em>',
    loading: 'Looking up your electricity payment…',
    left: (ms) => { const t = hoursMinutes(ms); return t.total < 60 ? `${t.total} min` : t.h < 48 ? `${t.h} h ${t.m} min` : `${t.d} days`; },
    open: (left) => `Waiting for a local agent to take it. ${left} left before it is refunded.`,
    claimed: 'A local agent is paying the bill now.',
    paid: 'The bill is paid. Your token is ready.',
    paidNoLink: 'The bill is paid. Open the full link you were sent to see the token.',
    refunded: 'This request was cancelled and the money went back to the sender.',
    expired: 'No agent took this request in time. The sender can get the money back.',
    amount: 'Amount', meter: 'Meter', company: 'Company',
    s1: 'Paid for by your family', s1d: 'The money is held safely until the bill is paid.',
    s2: 'An agent is paying it', s2d: 'A local agent has taken the request.',
    s3: 'Bill paid', s3d: 'The electricity company has confirmed the payment.',
    tokenTitle: 'Your electricity token',
    tokenHow: 'Type these numbers into the meter keypad, then press Enter.',
    units: 'Units', copy: 'Copy token', copied: 'Token copied',
    live: 'Updates by itself. You can leave this page open.',
    proof: 'See the public record of this payment on the NEAR explorer',
    noNear: 'Could not reach NEAR. Retrying.',
    noToken: 'Could not reach the token service. Retrying.',
    tokenLater: 'The token could not be fetched yet. Retrying.',
    badLink: (why) => `${why}. Ask the sender to send the link again.`,
    missingTitle: 'We could not find that request',
    missingText: 'Check that you opened the whole link you were sent. It is long, and some apps cut it short.',
  },

  yo: {
    eyebrow: 'Sendam · fún ilé rẹ',
    title: 'Iná mànàmáná fún <em>ilé rẹ</em>',
    loading: 'A ń wá ìsanwó iná rẹ…',
    left: (ms) => { const t = hoursMinutes(ms); return t.total < 60 ? `ìṣẹ́jú ${t.total}` : t.h < 48 ? `wákàtí ${t.h} àti ìṣẹ́jú ${t.m}` : `ọjọ́ ${t.d}`; },
    open: (left) => `A ń dúró de aṣojú kan láti gbà á. Ó ku ${left} kí owó náà tó padà.`,
    claimed: 'Aṣojú kan ń san owó iná náà báyìí.',
    paid: 'A ti san owó iná náà. Tókìn rẹ ti ṣetán.',
    paidNoLink: 'A ti san owó iná náà. Ṣí gbogbo líǹkì tí wọ́n fi ránṣẹ́ sí ọ láti rí tókìn náà.',
    refunded: 'A ti fagi lé ìbéèrè yìí, owó náà sì ti padà sọ́dọ̀ ẹni tó fi ránṣẹ́.',
    expired: 'Kò sí aṣojú tó gbà á lásìkò. Ẹni tó fi ránṣẹ́ lè gba owó rẹ̀ padà.',
    amount: 'Iye owó', meter: 'Mítà', company: 'Ilé-iṣẹ́ iná',
    s1: 'Ẹbí rẹ ti sanwó', s1d: 'A pa owó náà mọ́ láìséwu títí a ó fi san owó iná náà.',
    s2: 'Aṣojú kan ń san án', s2d: 'Aṣojú kan ní àdúgbò ti gba iṣẹ́ náà.',
    s3: 'A ti san owó iná', s3d: 'Ilé-iṣẹ́ iná ti fìdí ìsanwó náà múlẹ̀.',
    tokenTitle: 'Tókìn iná rẹ',
    tokenHow: 'Tẹ àwọn nọ́ńbà yìí sínú mítà rẹ, lẹ́yìn náà tẹ Enter.',
    units: 'Yúnìtì', copy: 'Ṣe ẹ̀dà tókìn', copied: 'A ti ṣe ẹ̀dà tókìn',
    live: 'Ó ń ṣe àtúnṣe fúnra rẹ̀. O lè fi ojú-ìwé yìí sílẹ̀ ní ṣíṣí.',
    proof: 'Wo àkọsílẹ̀ gbangba ìsanwó yìí lórí NEAR explorer',
    noNear: 'A kò lè dé NEAR. A ń gbìyànjú lẹ́ẹ̀kan sí i.',
    noToken: 'A kò lè gba tókìn náà báyìí. A ń gbìyànjú lẹ́ẹ̀kan sí i.',
    tokenLater: 'Tókìn náà kò tíì ṣetán. A ń gbìyànjú lẹ́ẹ̀kan sí i.',
    badLink: () => 'Líǹkì yìí kò tọ́. Sọ fún ẹni tó fi ránṣẹ́ pé kó tún fi ránṣẹ́.',
    missingTitle: 'A kò rí ìbéèrè yẹn',
    missingText: 'Ṣàyẹ̀wò pé o ṣí gbogbo líǹkì tí wọ́n fi ránṣẹ́ sí ọ. Ó gùn, àwọn áàpù kan sì máa ń gé e kúrú.',
  },

  pcm: {
    eyebrow: 'Sendam · for your house',
    title: 'Light for <em>your house</em>',
    loading: 'We dey find your light payment…',
    left: (ms) => { const t = hoursMinutes(ms); return t.total < 60 ? `${t.total} minutes` : t.h < 48 ? `${t.h} hours ${t.m} minutes` : `${t.d} days`; },
    open: (left) => `We dey wait make agent carry am. E remain ${left} before the money go back.`,
    claimed: 'Agent dey pay the bill now.',
    paid: 'Dem don pay the bill. Your token don ready.',
    paidNoLink: 'Dem don pay the bill. Open the full link wey dem send you to see the token.',
    refunded: 'Dem cancel this request, and the money don go back to the person wey send am.',
    expired: 'No agent carry this request on time. The person wey send am fit collect the money back.',
    amount: 'How much', meter: 'Meter', company: 'Light company',
    s1: 'Your family don pay', s1d: 'The money dey safe until dem pay the bill.',
    s2: 'Agent dey pay am', s2d: 'One agent for your area don carry the work.',
    s3: 'Bill don pay', s3d: 'The light company don confirm the payment.',
    tokenTitle: 'Your light token',
    tokenHow: 'Press these numbers for your meter, then press Enter.',
    units: 'Units', copy: 'Copy token', copied: 'Token don copy',
    live: 'E dey update by itself. You fit leave this page open.',
    proof: 'See the public record of this payment for NEAR explorer',
    noNear: 'We no fit reach NEAR. We dey try again.',
    noToken: 'We no fit get the token now. We dey try again.',
    tokenLater: 'The token never ready. We dey try again.',
    badLink: () => 'This link no correct. Tell the person wey send am make e send am again.',
    missingTitle: 'We no see that request',
    missingText: 'Check say you open the full link wey dem send you. E long, and some apps dey cut am short.',
  },
};
