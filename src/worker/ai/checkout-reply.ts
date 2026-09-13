import { z } from 'zod';
import type { OrderContext } from '../services/orders';
import type { getDraft } from '../services/orders';
import type { GeneratedReply } from './orchestrator';
import { nextOrderState } from '../services/order-state-machine';
import { style, type Language } from './language-style';
import { inference } from './models';
import { SYSTEM_RULES } from './prompts';
import { clarification, useMyName } from './conversation-routing';

type Draft = NonNullable<Awaited<ReturnType<typeof getDraft>>>;
export async function checkoutReply(
  ctx: OrderContext,
  draft: Draft,
  language: Language,
  facebookName: string | null,
  zones: string[],
  received: string[],
): Promise<GeneratedReply> {
  const state = nextOrderState(draft);
  const missing = [
    ...(state === 'COLLECTING_CUSTOMER_NAME' ? ['recipient name'] : []),
    ...(!draft.phone ? ['phone'] : []),
    ...(!draft.deliveryAddress ? ['address'] : []),
    ...(!draft.deliveryArea && draft.deliveryAddress ? ['delivery area'] : []),
  ];
  const acknowledgement = received.includes('deliveryAddress')
    ? style(language, {
        english: 'Thanks, I’ve got your address.',
        bangla: 'ধন্যবাদ, ঠিকানাটা পেয়েছি।',
        banglish: 'Thik ache, address-ta peyechi.',
      })
    : received.includes('customerName')
      ? style(language, {
          english: `Thanks, ${draft.customerName}.`,
          bangla: `ধন্যবাদ, ${draft.customerName}।`,
          banglish: `Thik ache, ${draft.customerName}.`,
        })
      : received.includes('phone')
        ? style(language, {
            english: 'Got your number, thanks.',
            bangla: 'নম্বরটা পেয়েছি, ধন্যবাদ।',
            banglish: 'Number-ta peyechi, thanks.',
          })
        : '';
  let question: string;
  if (state === 'COLLECTING_CUSTOMER_NAME') {
    question = facebookName
      ? style(language, {
          english: `Should I put the order in your Facebook name, ${facebookName}, or someone else’s?`,
          bangla: `অর্ডারটা আপনার Facebook-এর নাম ${facebookName}-এ দেব, নাকি অন্য কারও নামে?`,
          banglish: `Order-ta apnar Facebook-er name ${facebookName}-e dibo, naki onno karo name?`,
        })
      : style(language, {
          english: useMyName(ctx.sourceText)
            ? 'I don’t have your name yet. What name should we put on the order?'
            : 'What name should we put on the order?',
          bangla: 'অর্ডারে কোন নামটা দেবেন?',
          banglish: 'Order-e kon name-ta dibo? Apnar name-ta bolben?',
        });
    if (!draft.phone || !draft.deliveryAddress)
      question +=
        ' ' +
        style(language, {
          english: 'You can send your name, delivery number and full address together.',
          bangla: 'নাম, ডেলিভারির নম্বর আর পুরো ঠিকানা একসাথেও দিতে পারেন।',
          banglish: 'Name, delivery-r number ar full address ekshathe dite paren.',
        });
  } else if (!draft.phone) {
    question = style(language, {
      english: `What number can the delivery person call?${!draft.deliveryAddress ? ' Send your full address too, if you have it ready.' : ''}`,
      bangla: `ডেলিভারির জন্য কোন নম্বরে যোগাযোগ করব?${!draft.deliveryAddress ? ' সাথে পুরো ঠিকানাটাও দিতে পারেন।' : ''}`,
      banglish: `Delivery-r jonno kon number-e contact korbo?${!draft.deliveryAddress ? ' Sathe full address-tao dite paren.' : ''}`,
    });
  } else if (!draft.deliveryAddress) {
    question = style(language, {
      english: 'Where should we send it? Please share the house/road and area.',
      bangla: 'কোথায় পাঠাব? বাসা/রোড আর এলাকার নামসহ ঠিকানাটা দিন।',
      banglish: 'Kothay pathabo? Basha/road ar area-shoho address-ta din.',
    });
  } else {
    const options = zones.join(' / ');
    question = zones.length
      ? style(language, {
          english: `Which of these delivery areas covers your address: ${options}?`,
          bangla: `আপনার ঠিকানা কোন ডেলিভারি এলাকার মধ্যে: ${options}?`,
          banglish: `Apnar address kon delivery area-r moddhe: ${options}?`,
        })
      : style(language, {
          english:
            'I’ve kept your details. The seller needs to arrange the delivery area before we finish the order.',
          bangla:
            'আপনার তথ্য রাখা আছে। অর্ডার শেষ করতে বিক্রেতার কাছ থেকে ডেলিভারির এলাকা নিশ্চিত করতে হবে।',
          banglish:
            'Apnar details rakha ache. Order finish korar age seller-ke delivery area confirm korte hobe.',
        });
  }
  const explanation = clarification(ctx.sourceText)
    ? style(language, {
        english: 'Your details are still saved. ',
        bangla: 'আপনার দেওয়া তথ্য রাখা আছে। ',
        banglish: 'Apnar deya details save ache. ',
      })
    : '';
  const fallback = [explanation + acknowledgement, question].filter(Boolean).join(' ');
  let text = fallback;
  if (ctx.env.APP_MODE !== 'mock') {
    try {
      const result = await inference(ctx.env).json(
        z.object({ text: z.string().min(1).max(700) }),
        SYSTEM_RULES +
          ` Write a warm, natural checkout reply in ${language}, like a helpful shop assistant. Never claim to be human. Use 1-3 short sentences, acknowledge the latest message, avoid robotic repetition. The saved fields are already collected: NEVER ask for them again. Ask only for the missing fields; inviting several together is allowed. Facebook name is known identity, not an approved recipient name: if recipient name is missing offer it and ask if it is their name or someone else's. Never guess a name from 'my name'. For a delivery area, list the supplied exact options and clarify their meaning; do not invent or choose an area. Do not mention prices, discounts, deadlines, payment or order confirmation. No promises that the order is placed. The fallback is authoritative for what to ask.`,
        JSON.stringify({
          latestMessage: ctx.sourceText,
          facebookName,
          saved: {
            recipientName: state === 'COLLECTING_CUSTOMER_NAME' ? null : draft.customerName,
            phoneCollected: Boolean(draft.phone),
            addressCollected: Boolean(draft.deliveryAddress),
            deliveryArea: draft.deliveryArea,
          },
          missing,
          received,
          deliveryAreas: zones,
          fallback,
        }),
      );
      // The renderer cannot introduce monetary claims, fulfillment promises or numbers.
      const allowedNumbers = new Set(fallback.match(/\d+/g) ?? []);
      if (
        !/confirmed|placed|paid|payment|discount|free|tomorrow|টাকা|কনফার্ম|নিশ্চিত হয়েছে|\b(?:BDT|TK|taka)\b|[$€£]/iu.test(
          result.text,
        ) &&
        (result.text.match(/\d+/g) ?? []).every((n) => allowedNumbers.has(n))
      )
        text = result.text;
    } catch {
      /* A wording-model outage must not lose the draft or silence its next question. */
    }
  }
  return {
    text,
    productIds: [],
    language,
    metadata: {
      tool: 'order_draft',
      nextField: state,
      ...(state === 'COLLECTING_CUSTOMER_NAME' && facebookName
        ? { offeredProfileName: facebookName }
        : {}),
    },
  };
}
