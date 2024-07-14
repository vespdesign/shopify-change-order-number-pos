const express = require('express');
const { Shopify, ApiVersion } = require('@shopify/shopify-api');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const {
  API_KEY,
  API_SECRET,
  SCOPES,
  SHOP,
  HOST,
  POS_LOCATION_ID
} = process.env;

Shopify.Context.initialize({
  API_KEY: API_KEY,
  API_SECRET_KEY: API_SECRET,
  SCOPES: [SCOPES],
  HOST_NAME: HOST.replace(/https:\/\//, ''),
  API_VERSION: ApiVersion.October21,
  IS_EMBEDDED_APP: false,
  SESSION_STORAGE: new Shopify.Session.MemorySessionStorage(),
});

app.use(express.json());

app.get('/auth', async (req, res) => {
  const authRoute = await Shopify.Auth.beginAuth(
    req,
    res,
    SHOP,
    '/auth/callback',
    false
  );
  res.redirect(authRoute);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const session = await Shopify.Auth.validateAuthCallback(req, res, req.query);
    const accessToken = session.accessToken;

    // Guardar el token de acceso para uso futuro

    res.send('App successfully authenticated');
  } catch (error) {
    console.error(error);
    res.status(500).send('Authentication failed');
  }
});

// Suscribirse al webhook de creación de órdenes
app.post('/webhooks/orders/create', async (req, res) => {
  try {
    const order = req.body;

    if (order.location_id == POS_LOCATION_ID) {
      const newOrderNumber = await getNextOrderNumber();
      await axios.put(`https://${SHOP}/admin/api/2021-04/orders/${order.id}.json`, {
        order: {
          id: order.id,
          note_attributes: [
            { name: 'custom_order_number', value: newOrderNumber }
          ]
        }
      }, {
        headers: {
          'X-Shopify-Access-Token': API_KEY
        }
      });
    }

    res.status(200).send('Webhook processed');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error processing webhook');
  }
});

function getNextOrderNumber() {
  return new Promise((resolve, reject) => {
    db.get("SELECT last_order_number FROM order_numbers WHERE pos_location_id = ?", [POS_LOCATION_ID], (err, row) => {
      if (err) {
        reject(err);
      } else {
        const newOrderNumber = row.last_order_number + 1;
        db.run("UPDATE order_numbers SET last_order_number = ? WHERE pos_location_id = ?", [newOrderNumber, POS_LOCATION_ID], (err) => {
          if (err) {
            reject(err);
          } else {
            resolve(newOrderNumber);
          }
        });
      }
    });
  });
}

const db = new sqlite3.Database(':memory:');

db.serialize(() => {
  db.run("CREATE TABLE order_numbers (pos_location_id INTEGER, last_order_number INTEGER)");

  const stmt = db.prepare("INSERT INTO order_numbers VALUES (?, ?)");
  stmt.run(POS_LOCATION_ID, 99999); // Start from 100000
  stmt.finalize();
});

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`);
});
