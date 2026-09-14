import { geminiAgentStep } from '../src/worker/ai/gemini-agent';
import { AGENT_PROMPT } from '../src/worker/ai/agent-prompt';
import { agentFunctions } from '../src/worker/ai/agent-tools';
export default {async fetch(request,env){
 const scenarios=[
  {text:'Ki ki ponno ache?',state:'COLLECTING_CUSTOMER_NAME'},
  {text:'Amr full address 97 Asad Ave, Dhaka, Bangladesh, 1207',state:'AWAITING_CONFIRMATION'},
  {text:'Dhakar moddhe',state:'COLLECTING_DELIVERY_AREA'},
  {text:'Na bolsi order ta confirm ki na',state:'CONFIRMED'},
  {text:'thanks bhai',state:'COLLECTING_ADDRESS'},
 ];
 const scenario=scenarios[Number(new URL(request.url).searchParams.get('case')||'0')];
 const context={store:{name:'Synthetic demo shop',currency:'BDT'},customer:{facebookName:'Test Customer',preferredLanguage:'banglish'},draft:{id:'draft-demo',state:scenario.state,customerName:'Test Customer',phone:'01712345678',deliveryAddress:'Old Road 10',deliveryArea:null,items:[{productId:'earbud-demo',variantId:'earbud-black',quantity:1}]},history:[],currentMessage:{text:scenario.text,imageIds:[]}};
 const contents=[{role:'user',parts:[{text:JSON.stringify(context)}]}];
 const trace=[];
 for(let round=0;round<4;round++){
  const output=await geminiAgentStep(env,AGENT_PROMPT,contents,agentFunctions);contents.push(output);
  const calls=output.parts.flatMap(p=>p.functionCall?[p.functionCall]:[]);
  if(!calls.length)return Response.json({scenario:scenario.text,trace,text:output.parts.filter(p=>!p.thought).map(p=>p.text||'').join('')});
  const responses=[];
  for(const call of calls){
   trace.push(call);
   if(call.name==='respond_to_customer')return Response.json({scenario:scenario.text,trace});
   let result;
   if(call.name==='get_delivery_options')result=[{id:'inside',name:'Inside Dhaka',fee:'BDT 80'},{id:'outside',name:'Outside Dhaka',fee:'BDT 120'}];
   else if(call.name==='get_order_status')result=[{orderNumber:'IP-DEMO123',status:'confirmed'}];
   else if(['browse_catalog','search_products','get_product_details'].includes(call.name))result=[{id:'earbud-demo',name:'Demo Earbuds',price:'BDT 2000',variants:[{id:'earbud-black',title:'Black',available:5,price:'BDT 2000'}]}];
   else if(call.name==='update_order_draft')result={draft:{...context.draft,...call.args.fields},fieldErrors:[]};
   else if(call.name==='get_order_context')result=context;
   else result={error:{code:'PROBE_ONLY',message:'This synthetic probe cannot perform this action. Explain or clarify instead.'}};
   responses.push({functionResponse:{name:call.name,...(call.id?{id:call.id}:{}),response:{result}}});
  }
  contents.push({role:'user',parts:responses});
 }
 return Response.json({scenario:scenario.text,trace});
}};
