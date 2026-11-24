// Vehicle details from the government registry (TRA motor vehicle register) by registration number or VIN.
//
// VEHICLE_LOOKUP_PROVIDER:
//   none : not connected. Sellers type the details themselves (the default until TRA access is approved).
//   mock : sample records for development and demos (see SAMPLES below).
//   tra  : the TRA API. Set TRA_API_URL and TRA_API_KEY, then map TRA's response in fromTra() below.
//
// Every result is shown to the seller to review and confirm. Nothing is published from it directly.
import { normId } from '../lib/ids.js';
import { listCategories } from './categories.js';

const provider = () => (process.env.VEHICLE_LOOKUP_PROVIDER || 'none').toLowerCase();

/** Development sample records (none of these plates are in the demo marketplace). */
const SAMPLES = [
  { regNumber: 'T123DEF', vin: 'MBJAA3GS200456789', engineNo: '2GD4567890', vehicle: { category: 'car', make: 'Toyota', model: 'Fortuner', variant: '4x4', year: '2021', color: 'Polar White', bodyType: 'SUV', fuel: 'Diesel', transmission: 'Automatic', engineCc: '2755', seats: '7', ownerName: 'Juma Hassan Mwakyusa' } },
  { regNumber: 'T456DCB', vin: 'MA3FJEB1S00654321', engineNo: 'K12MN7654321', vehicle: { category: 'car', make: 'Suzuki', model: 'Swift', variant: 'VXi', year: '2020', color: 'Lava Red', bodyType: 'Hatchback', fuel: 'Petrol', transmission: 'Manual', engineCc: '1197', seats: '5', ownerName: 'Neema Joseph Mollel' } },
  { regNumber: 'MC456ABC', vin: 'MD2A11CZ5PCA12345', engineNo: 'PFZCPA12345', vehicle: { category: 'motorcycle', make: 'Bajaj', model: 'Boxer 150', variant: 'X', year: '2023', color: 'Midnight Black', bodyType: 'Commuter', fuel: 'Petrol', transmission: 'Manual', engineCc: '144', seats: '2', ownerName: 'Baraka Elias Kimaro' } },
];

/** Map the TRA API response to our fields. Adjust once TRA shares its response format. */
function fromTra(r, categories) {
  // Match TRA's vehicle class to a category using each category's "registry vehicle classes" (Admin → Categories).
  const cls = `${r.vehicleType || ''} ${r.bodyType || ''}`.toLowerCase();
  const match = categories.find((c) => (c.registryTypes || []).some((t) => t && cls.includes(t.toLowerCase())));
  return {
    category: match?.key,
    make: r.make,
    model: r.model,
    year: r.yearOfManufacture ? String(r.yearOfManufacture) : undefined,
    color: r.colour || r.color,
    bodyType: r.bodyType,
    fuel: r.fuelType,
    engineCc: r.engineCapacity ? String(r.engineCapacity) : undefined,
    seats: r.seatingCapacity ? String(r.seatingCapacity) : undefined,
    ownerName: r.ownerName,
    vin: r.chassisNumber,
    engineNo: r.engineNumber,
    regNumber: r.registrationNumber,
  };
}

/**
 * @returns {Promise<{status:'unavailable'|'found'|'not_found', source?:string, vehicle?:object, message?:string}>}
 */
export async function lookupVehicle({ regNumber, vin }) {
  const reg = normId(regNumber);
  const v = normId(vin);
  const p = provider();

  if (p === 'mock') {
    const hit = SAMPLES.find((s) => (reg && s.regNumber === reg) || (v && s.vin === v));
    if (!hit) return { status: 'not_found', source: 'Sample registry (development)', message: 'No record found for that registration number or VIN.' };
    return { status: 'found', source: 'Sample registry (development)', vehicle: { ...hit.vehicle, regNumber: hit.regNumber, vin: hit.vin, engineNo: hit.engineNo } };
  }

  if (p === 'tra') {
    const url = process.env.TRA_API_URL;
    const key = process.env.TRA_API_KEY;
    if (!url || !key) return { status: 'unavailable', message: 'The TRA lookup is switched on but not configured.' };
    try {
      const q = new URLSearchParams({ ...(reg ? { registrationNumber: reg } : {}), ...(v ? { chassisNumber: v } : {}) });
      const res = await fetch(`${url.replace(/\/$/, '')}?${q}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (res.status === 404) return { status: 'not_found', source: 'TRA', message: 'TRA has no record for that registration number or VIN.' };
      if (!res.ok) return { status: 'unavailable', message: `TRA didn't respond (${res.status}). Enter the details yourself for now.` };
      const categories = await listCategories({ enabledOnly: true });
      const vehicle = Object.fromEntries(Object.entries(fromTra(await res.json(), categories)).filter(([, x]) => x != null && x !== ''));
      return { status: 'found', source: 'TRA', vehicle };
    } catch {
      return { status: 'unavailable', message: "TRA didn't respond. Enter the details yourself for now." };
    }
  }

  return { status: 'unavailable', message: "Automatic lookup from TRA isn't connected yet. Enter the vehicle details yourself." };
}
