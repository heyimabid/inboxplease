import { expect, it } from 'vitest';
import { statedDeliveryZone } from '../../src/worker/services/delivery-zone';
it('recognizes stated Dhaka area equivalents without guessing a location or resolving ambiguity', () => {
  const zones = ['Inside Dhaka', 'Outside Dhaka'];
  for (const text of ['Dhakar moddhe', 'Dhakar vitore', 'ঢাকার মধ্যে', 'Inside Dhaka'])
    expect(statedDeliveryZone(text, zones)).toBe('Inside Dhaka');
  expect(statedDeliveryZone('Dhakar baire', zones)).toBe('Outside Dhaka');
  for (const text of [
    '97 Asad Ave, Dhaka',
    'not inside Dhaka',
    'Dhakar vitore na',
    'Inside Dhaka?',
    'inside Dhaka or outside Dhaka',
  ])
    expect(statedDeliveryZone(text, zones)).toBeNull();
  expect(statedDeliveryZone('Dhakar moddhe', ['Dhakar vitore', 'Inside Dhaka'])).toBeNull();
  expect(statedDeliveryZone('Chattogram', ['Chattogram'])).toBe('Chattogram');
});
