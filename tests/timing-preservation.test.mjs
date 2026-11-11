import assert from 'node:assert/strict';
import test from 'node:test';

test('base setup preserves timing subtrees and never accesses clock controls', async t => {
  let scrubbed = false;
  t.mock.module('vutil', { namedExports: {
    enumerate:()=>{}, range:()=>{},
    scrub: async (_vm, {kwl_whitelist}) => {
      scrubbed = true;
      for (const path of ['p_t_p_flows.agents.0','p_t_p_flows.agents[0]','p_t_p_clock',
        'genlock.instances','master_clock.ltc_generators','system_clock','time_flows.combinators']) {
        assert(kwl_whitelist.some(r=>r.test(path)),`${path} must survive scrub`);
      }
      for (const path of ['r_t_p_transmitter.sessions','r_t_p_receiver.sessions','audio_gain.instances']) {
        assert(!kwl_whitelist.some(r=>r.test(path)),`${path} must still be cleared`);
      }
    },
  }});
  t.mock.module('vutil/sdi_connections.js', { namedExports: {setup_sdi_io:async()=>{}} });
  const {base} = await import('../build/base.js');
  const write = async()=>{};
  const data = {
    raw:{identify:()=> 'mock'},
    r_t_p_receiver:{settings:{clean_switching_policy:{write}}},
    r_t_p_transmitter:{settings:{reserved_bandwidth:{write}}},
    audio_shuffler:{global_cross_fade:{write}},
  };
  const vm = new Proxy(data,{get:(obj,key)=>{
    if (['p_t_p_clock','p_t_p_flows','genlock','master_clock','system_clock','time_flows'].includes(key)) {
      throw Error(`Unexpected timing access: ${key}`);
    }
    return obj[key];
  }});
  await base(vm);
  assert(scrubbed);
});
