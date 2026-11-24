// Model catalogue for buses, construction machinery and farm machinery (prices in TSh).
// Picking one of these models in the listing form fills in its type and specifications.
// Brands and models not listed here can still be typed in by the seller.
export const MORE_MODELS = [
  // Buses & minibuses
  { category: 'bus', make: 'Toyota', model: 'HiAce Commuter', body: 'Minibus', fuels: ['Diesel', 'Petrol'], price: 95000000, specs: { seats: 14, standing: 0, powerHp: 150, airCon: 'Yes', doors: 1 }, variants: ['High roof', 'Standard roof'], vin: 'JTF' },
  { category: 'bus', make: 'Toyota', model: 'Coaster', body: 'Coaster', fuels: ['Diesel'], price: 210000000, specs: { seats: 30, standing: 0, powerHp: 148, airCon: 'Yes', doors: 1 }, variants: ['29-seater', '30-seater'], vin: 'JTG' },
  { category: 'bus', make: 'Nissan', model: 'Civilian', body: 'Coaster', fuels: ['Diesel'], price: 160000000, specs: { seats: 26, standing: 0, powerHp: 140, airCon: 'No', doors: 1 }, variants: ['Standard', 'Long body'], vin: 'JN1' },
  { category: 'bus', make: 'Isuzu', model: 'NQR 33-seater', body: 'Staff bus', fuels: ['Diesel'], price: 175000000, specs: { seats: 33, standing: 10, powerHp: 150, airCon: 'No', doors: 1 }, variants: ['Standard', 'School bus'], vin: 'JAA' },
  { category: 'bus', make: 'Yutong', model: 'ZK6122H9', body: 'Coach', fuels: ['Diesel'], price: 420000000, specs: { seats: 61, standing: 0, powerHp: 336, airCon: 'Yes', doors: 1 }, variants: ['Luxury', 'Semi-luxury'], vin: 'LZY' },
  { category: 'bus', make: 'King Long', model: 'XMQ6127', body: 'Coach', fuels: ['Diesel'], price: 380000000, specs: { seats: 57, standing: 0, powerHp: 340, airCon: 'Yes', doors: 1 }, variants: ['Luxury', 'Executive'], vin: 'LKL' },
  { category: 'bus', make: 'Higer', model: 'KLQ6129', body: 'Coach', fuels: ['Diesel'], price: 360000000, specs: { seats: 60, standing: 0, powerHp: 330, airCon: 'Yes', doors: 1 }, variants: ['Standard', 'VIP'], vin: 'LKL' },
  { category: 'bus', make: 'Zhongtong', model: 'LCK6105', body: 'City bus', fuels: ['Diesel', 'Electric'], price: 300000000, specs: { seats: 32, standing: 60, powerHp: 240, airCon: 'Yes', doors: 2 }, variants: ['BRT', 'City'], vin: 'LZZ' },
  // Construction & heavy machinery
  { category: 'construction', make: 'Caterpillar', model: '320 GC', body: 'Excavator', fuels: ['Diesel'], price: 520000000, specs: { operatingWeightT: 22, powerHp: 160, bucketM3: 1.2, attachments: 'General-purpose bucket' }, variants: ['Standard', 'Long reach'], vin: 'CAT' },
  { category: 'construction', make: 'Komatsu', model: 'PC200-8', body: 'Excavator', fuels: ['Diesel'], price: 450000000, specs: { operatingWeightT: 20, powerHp: 148, bucketM3: 1, attachments: 'Bucket' }, variants: ['Standard', 'Hydraulic hammer line'], vin: 'KMT' },
  { category: 'construction', make: 'JCB', model: '3DX Backhoe', body: 'Backhoe loader', fuels: ['Diesel'], price: 230000000, specs: { operatingWeightT: 7.5, powerHp: 76, bucketM3: 1.1, attachments: 'Front bucket and rear backhoe' }, variants: ['Super', 'Xtra'], vin: 'JCB' },
  { category: 'construction', make: 'Caterpillar', model: 'D6R Dozer', body: 'Bulldozer', fuels: ['Diesel'], price: 600000000, specs: { operatingWeightT: 20, powerHp: 185, attachments: 'Semi-U blade, ripper' }, variants: ['XL', 'LGP'], vin: 'CAT' },
  { category: 'construction', make: 'XCMG', model: 'LW500FN', body: 'Wheel loader', fuels: ['Diesel'], price: 260000000, specs: { operatingWeightT: 17, powerHp: 220, bucketM3: 3, attachments: '3 m³ bucket' }, variants: ['Standard', 'Rock bucket'], vin: 'LXG' },
  { category: 'construction', make: 'SANY', model: 'STC250 Truck Crane', body: 'Crane', fuels: ['Diesel'], price: 700000000, specs: { liftCapacityT: 25, powerHp: 290, operatingWeightT: 32 }, variants: ['Standard'], vin: 'LSY' },
  { category: 'construction', make: 'Shantui', model: 'SG21 Motor Grader', body: 'Motor grader', fuels: ['Diesel'], price: 330000000, specs: { operatingWeightT: 15.5, powerHp: 210, attachments: 'Blade, rear ripper' }, variants: ['Standard'], vin: 'LST' },
  // Farm & agricultural machinery
  { category: 'agricultural', make: 'Massey Ferguson', model: 'MF 375', body: 'Tractor', fuels: ['Diesel'], price: 75000000, specs: { powerHp: 75, driveType: '2WD', ptoHp: 64 }, variants: ['Standard', 'With disc plough'], vin: 'MF3' },
  { category: 'agricultural', make: 'Massey Ferguson', model: 'MF 385 4WD', body: 'Tractor', fuels: ['Diesel'], price: 98000000, specs: { powerHp: 85, driveType: '4WD', ptoHp: 72 }, variants: ['Standard', 'With harrow'], vin: 'MF3' },
  { category: 'agricultural', make: 'John Deere', model: '5075E', body: 'Tractor', fuels: ['Diesel'], price: 110000000, specs: { powerHp: 75, driveType: '4WD', ptoHp: 63 }, variants: ['Open station', 'Cab'], vin: '1PY' },
  { category: 'agricultural', make: 'New Holland', model: 'TT75', body: 'Tractor', fuels: ['Diesel'], price: 82000000, specs: { powerHp: 75, driveType: '2WD', ptoHp: 64 }, variants: ['2WD', '4WD'], vin: 'NHT' },
  { category: 'agricultural', make: 'Kubota', model: 'L4508', body: 'Tractor', fuels: ['Diesel'], price: 60000000, specs: { powerHp: 45, driveType: '4WD', ptoHp: 38 }, variants: ['Standard'], vin: 'KBT' },
  { category: 'agricultural', make: 'Mahindra', model: '575 DI', body: 'Tractor', fuels: ['Diesel'], price: 42000000, specs: { powerHp: 45, driveType: '2WD', ptoHp: 39 }, variants: ['XP Plus', 'Sarpanch'], vin: 'MAH' },
  { category: 'agricultural', make: 'Kubota', model: 'DC-70 Combine', body: 'Combine harvester', fuels: ['Diesel'], price: 180000000, specs: { powerHp: 70, attachments: 'Rice and wheat header' }, variants: ['Standard', 'Plus'], vin: 'KBT' },
  { category: 'agricultural', make: 'Sonalika', model: 'DI 60 RX', body: 'Tractor', fuels: ['Diesel'], price: 48000000, specs: { powerHp: 60, driveType: '2WD', ptoHp: 51 }, variants: ['Standard'], vin: 'SON' },
];
