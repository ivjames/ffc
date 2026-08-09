// Seed data for the mock CenterEdge backend. Shapes are our best guess at the
// real Advantage Web Services contract (categories → items → modifier groups;
// player card with cash / game-play credits / tickets) — field names are
// deliberately boring so remapping to the real API is a rename, not a rewrite.
//
// All money is integer cents. All ids are stable strings so the frontend can
// hard-code fixtures in stories/tests — in particular the tests pin
// item-pizza-cheese / mod-size-16 / mod-top-pepperoni / item-fountain /
// mod-drink-lg prices; change those and update app.test.js's CART_TOTAL.

// Shared modifier groups. Every pizza takes the same size + toppings choices.
const PIZZA_SIZE = {
  id: 'mg-pizza-size',
  name: 'Size',
  required: true,
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: 'mod-size-12', name: '12" Medium', priceCents: 0 },
    { id: 'mod-size-16', name: '16" Large', priceCents: 400 },
  ],
};

const PIZZA_TOPPINGS = {
  id: 'mg-pizza-toppings',
  name: 'Extra Toppings',
  required: false,
  minSelect: 0,
  maxSelect: 5,
  options: [
    { id: 'mod-top-pepperoni', name: 'Pepperoni', priceCents: 150 },
    { id: 'mod-top-sausage', name: 'Sausage', priceCents: 150 },
    { id: 'mod-top-bacon', name: 'Bacon', priceCents: 150 },
    { id: 'mod-top-mushroom', name: 'Mushroom', priceCents: 100 },
    { id: 'mod-top-onion', name: 'Red Onion', priceCents: 100 },
    { id: 'mod-top-pepper', name: 'Bell Pepper', priceCents: 100 },
    { id: 'mod-top-olive', name: 'Black Olives', priceCents: 100 },
    { id: 'mod-top-pineapple', name: 'Pineapple', priceCents: 100 },
  ],
};

const BURGER_PREP = {
  id: 'mg-burger-prep',
  name: 'Preparation',
  required: false,
  minSelect: 0,
  maxSelect: 4,
  options: [
    { id: 'mod-no-onion', name: 'No Onion', priceCents: 0 },
    { id: 'mod-no-pickle', name: 'No Pickle', priceCents: 0 },
    { id: 'mod-no-tomato', name: 'No Tomato', priceCents: 0 },
    { id: 'mod-add-bacon', name: 'Add Bacon', priceCents: 200 },
  ],
};

const SALAD_DRESSING = {
  id: 'mg-dressing',
  name: 'Dressing',
  required: true,
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: 'mod-dress-ranch', name: 'Ranch', priceCents: 0 },
    { id: 'mod-dress-caesar', name: 'Caesar', priceCents: 0 },
    { id: 'mod-dress-balsamic', name: 'Balsamic Vinaigrette', priceCents: 0 },
    { id: 'mod-dress-none', name: 'No Dressing', priceCents: 0 },
  ],
};

const SALAD_PROTEIN = {
  id: 'mg-salad-protein',
  name: 'Add Protein',
  required: false,
  minSelect: 0,
  maxSelect: 1,
  options: [
    { id: 'mod-prot-chicken', name: 'Grilled Chicken', priceCents: 350 },
    { id: 'mod-prot-crispy', name: 'Crispy Chicken', priceCents: 350 },
  ],
};

const DRINK_SIZE = {
  id: 'mg-drink-size',
  name: 'Size',
  required: true,
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: 'mod-drink-sm', name: 'Small', priceCents: 0 },
    { id: 'mod-drink-lg', name: 'Large', priceCents: 100 },
  ],
};

export const MENU = {
  menuId: 'menu-main',
  name: 'Main Menu',
  currency: 'USD',
  taxRatePct: 7.75,
  categories: [
    {
      id: 'cat-pizza',
      name: 'Pizza',
      sortOrder: 10,
      items: [
        {
          id: 'item-pizza-cheese',
          name: 'Cheese Pizza',
          description: 'House red sauce and mozzarella.',
          priceCents: 1299,
          imageUrl: null,
          available: true,
          modifierGroups: [PIZZA_SIZE, PIZZA_TOPPINGS],
        },
        {
          id: 'item-pizza-pep',
          name: 'Pepperoni Pizza',
          description: 'Loaded with pepperoni.',
          priceCents: 1449,
          imageUrl: null,
          available: true,
          modifierGroups: [PIZZA_SIZE, PIZZA_TOPPINGS],
        },
        {
          id: 'item-pizza-meat',
          name: 'Meat Lovers Pizza',
          description: 'Pepperoni, sausage, and bacon.',
          priceCents: 1649,
          imageUrl: null,
          available: true,
          modifierGroups: [PIZZA_SIZE, PIZZA_TOPPINGS],
        },
        {
          id: 'item-pizza-veggie',
          name: 'Veggie Pizza',
          description: 'Mushroom, bell pepper, red onion, and olives.',
          priceCents: 1549,
          imageUrl: null,
          available: true,
          modifierGroups: [PIZZA_SIZE, PIZZA_TOPPINGS],
        },
        {
          id: 'item-pizza-bbq',
          name: 'BBQ Chicken Pizza',
          description: 'BBQ sauce, grilled chicken, and red onion.',
          priceCents: 1599,
          imageUrl: null,
          available: true,
          modifierGroups: [PIZZA_SIZE, PIZZA_TOPPINGS],
        },
      ],
    },
    {
      id: 'cat-burgers',
      name: 'Burgers',
      sortOrder: 20,
      items: [
        {
          id: 'item-burger',
          name: 'Cheeseburger',
          description: 'Quarter-pound burger with fries.',
          priceCents: 1099,
          imageUrl: null,
          available: true,
          modifierGroups: [BURGER_PREP],
        },
        {
          id: 'item-burger-double',
          name: 'Double Cheeseburger',
          description: 'Two patties, double cheese, with fries.',
          priceCents: 1399,
          imageUrl: null,
          available: true,
          modifierGroups: [BURGER_PREP],
        },
        {
          id: 'item-burger-veggie',
          name: 'Veggie Burger',
          description: 'Plant-based patty with fries.',
          priceCents: 1199,
          imageUrl: null,
          available: true,
          modifierGroups: [BURGER_PREP],
        },
        {
          id: 'item-tenders',
          name: 'Chicken Tenders Basket',
          description: 'Four tenders with fries and a dip.',
          priceCents: 999,
          imageUrl: null,
          available: true,
          modifierGroups: [
            {
              id: 'mg-dip',
              name: 'Dipping Sauce',
              required: true,
              minSelect: 1,
              maxSelect: 1,
              options: [
                { id: 'mod-dip-ranch', name: 'Ranch', priceCents: 0 },
                { id: 'mod-dip-bbq', name: 'BBQ', priceCents: 0 },
                { id: 'mod-dip-honmus', name: 'Honey Mustard', priceCents: 0 },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'cat-salads',
      name: 'Salads',
      sortOrder: 30,
      items: [
        {
          id: 'item-salad-caesar',
          name: 'Caesar Salad',
          description: 'Romaine, parmesan, croutons.',
          priceCents: 899,
          imageUrl: null,
          available: true,
          modifierGroups: [SALAD_DRESSING, SALAD_PROTEIN],
        },
        {
          id: 'item-salad-garden',
          name: 'Garden Salad',
          description: 'Mixed greens, tomato, cucumber, carrot.',
          priceCents: 799,
          imageUrl: null,
          available: true,
          modifierGroups: [SALAD_DRESSING, SALAD_PROTEIN],
        },
        {
          id: 'item-salad-cobb',
          name: 'Cobb Salad',
          description: 'Greens, egg, bacon, avocado, blue cheese.',
          priceCents: 1099,
          imageUrl: null,
          available: true,
          modifierGroups: [SALAD_DRESSING],
        },
      ],
    },
    {
      id: 'cat-snacks',
      name: 'Snacks',
      sortOrder: 40,
      items: [
        {
          id: 'item-pretzel',
          name: 'Soft Pretzel',
          description: 'With cheese sauce.',
          priceCents: 599,
          imageUrl: null,
          available: true,
          modifierGroups: [],
        },
        {
          id: 'item-nachos',
          name: 'Nachos',
          description: 'Chips, cheese, jalapeños.',
          priceCents: 749,
          imageUrl: null,
          available: false, // 86'd — frontend must handle unavailable items
          modifierGroups: [],
        },
      ],
    },
    {
      id: 'cat-drinks',
      name: 'Drinks',
      sortOrder: 50,
      items: [
        {
          id: 'item-fountain',
          name: 'Fountain Drink',
          description: 'Free refills at the counter.',
          priceCents: 299,
          imageUrl: null,
          available: true,
          modifierGroups: [DRINK_SIZE],
        },
        {
          id: 'item-lemonade',
          name: 'Fresh Lemonade',
          description: 'Squeezed daily.',
          priceCents: 399,
          imageUrl: null,
          available: true,
          modifierGroups: [DRINK_SIZE],
        },
        {
          id: 'item-water',
          name: 'Bottled Water',
          description: '',
          priceCents: 249,
          imageUrl: null,
          available: true,
          modifierGroups: [],
        },
        {
          id: 'item-icee',
          name: 'ICEE',
          description: 'Blue raspberry or cherry.',
          priceCents: 449,
          imageUrl: null,
          available: true,
          modifierGroups: [
            {
              id: 'mg-icee-flavor',
              name: 'Flavor',
              required: true,
              minSelect: 1,
              maxSelect: 1,
              options: [
                { id: 'mod-icee-blue', name: 'Blue Raspberry', priceCents: 0 },
                { id: 'mod-icee-cherry', name: 'Cherry', priceCents: 0 },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'cat-desserts',
      name: 'Desserts',
      sortOrder: 60,
      items: [
        {
          id: 'item-dippin',
          name: 'Ice Cream Cup',
          description: 'Vanilla or chocolate.',
          priceCents: 499,
          imageUrl: null,
          available: true,
          modifierGroups: [],
        },
      ],
    },
  ],
};

// Player card accounts. Lookup works by `id` or by `cardNumber` (staff will
// often scan the physical card). Balances mirror CenterEdge's split between
// spendable cash, game-play credits, and redemption tickets.
export const PLAYERS = [
  {
    id: 'PL-1001',
    cardNumber: '770001112223',
    displayName: 'Ava Martinez',
    email: 'ava@example.com',
    memberSince: '2025-03-14',
    tier: 'gold',
    balances: { gamePlayCredits: 120, tickets: 4380 },
  },
  {
    id: 'PL-1002',
    cardNumber: '770001112230',
    displayName: 'Sam Chen',
    email: 'sam@example.com',
    memberSince: '2026-01-02',
    tier: 'standard',
    balances: { gamePlayCredits: 8, tickets: 215 },
  },
  {
    id: 'PL-1003',
    cardNumber: '770001112247',
    displayName: 'Riley Okafor',
    email: null, // walk-up card with no profile — frontend must handle sparse data
    memberSince: '2026-08-01',
    tier: 'standard',
    balances: { gamePlayCredits: 0, tickets: 0 },
  },
];
