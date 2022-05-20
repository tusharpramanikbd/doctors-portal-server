const express = require('express')
const cors = require('cors')
require('dotenv').config()
const jwt = require('jsonwebtoken')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const res = require('express/lib/response')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const app = express()
const port = process.env.PORT || 5000

app.use(cors())
app.use(express.json())

// JWT token verification function
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization
  if (!authHeader) {
    return res.status(401).send({ message: 'Unauthorized Access' })
  }
  const token = authHeader.split(' ')[1]
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: 'Forbidden Access' })
    }
    req.decoded = decoded
  })
  next()
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.bqe6s.mongodb.net/?retryWrites=true&w=majority`

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
})

async function run() {
  try {
    await client.connect()

    const serviceCollection = client.db('doctors_portal').collection('services')
    const bookingCollection = client.db('doctors_portal').collection('booking')
    const userCollection = client.db('doctors_portal').collection('users')
    const doctorCollection = client.db('doctors_portal').collection('doctors')
    const paymentCollection = client.db('doctors_portal').collection('payments')

    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email
      const requestedAccount = await userCollection.findOne({
        email: requester,
      })
      if (requestedAccount.role === 'admin') {
        next()
      } else {
        res.status(403).send({ message: 'forbidden' })
      }
    }

    app.post('/create-payment-intent', verifyJWT, async (req, res) => {
      const service = req.body
      const price = service.price
      const amount = price * 100

      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card'],
      })

      res.send({
        clientSecret: paymentIntent.client_secret,
      })
    })

    app.put('/user/:email', async (req, res) => {
      const email = req.params.email
      const user = req.body
      const filter = { email: email }
      const options = { upsert: true }
      const updatedDoc = {
        $set: user,
      }
      const result = await userCollection.updateOne(filter, updatedDoc, options)
      const accessToken = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        {
          expiresIn: '1d',
        }
      )
      res.send({ result, accessToken })
    })

    app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email
      const filter = { email: email }
      const updatedDoc = {
        $set: { role: 'admin' },
      }
      const result = await userCollection.updateOne(filter, updatedDoc)
      res.send(result)
    })

    app.get('/services', async (req, res) => {
      const query = {}
      const cursor = serviceCollection.find(query).project({ name: 1 })
      const services = await cursor.toArray()
      res.send(services)
    })

    app.get('/available', async (req, res) => {
      const date = req.query.date || 'May 18, 2022'

      // step 1 : get all the services
      const services = await serviceCollection.find().toArray()

      // step 2: get the booking of that day
      const query = { date: date }
      const bookings = await bookingCollection.find(query).toArray()

      // step 3: for each service, find bookings for that service
      services.forEach((service) => {
        const serviceBookings = bookings.filter(
          (b) => b.treatment === service.name
        )
        const booked = serviceBookings.map((s) => s.slot)
        const available = service.slots.filter((s) => !booked.includes(s))
        service.slots = available
      })

      res.send(services)
    })

    app.get('/user', verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray()
      res.send(users)
    })

    app.get('/booking', verifyJWT, async (req, res) => {
      const patient = req.query.patient
      const decodedEmail = req.decoded.email
      if (decodedEmail === patient) {
        const query = { patient: patient }
        const bookings = await bookingCollection.find(query).toArray()
        res.send(bookings)
      } else {
        return res.status(403).send({ message: 'Forbidden Access' })
      }
    })

    app.get('/booking/:id', verifyJWT, async (req, res) => {
      const id = req.params.id
      const query = { _id: ObjectId(id) }
      const booking = await bookingCollection.findOne(query)
      res.send(booking)
    })

    app.post('/booking', async (req, res) => {
      const booking = req.body
      const query = {
        treatment: booking.treatment,
        date: booking.date,
        patient: booking.patient,
      }
      const exists = await bookingCollection.findOne(query)
      if (exists) {
        return res.send({ success: false, booking: exists })
      }
      const result = await bookingCollection.insertOne(booking)
      return res.send({ success: true, result })
    })

    app.patch('/booking/:id', verifyJWT, async (req, res) => {
      const id = req.params.id
      const payment = req.body
      const filter = { _id: ObjectId(id) }
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      }

      const updatedBooking = await bookingCollection.updateOne(
        filter,
        updatedDoc
      )
      const result = await paymentCollection.insertOne(payment)

      res.send(updatedBooking)
    })

    app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
      const doctors = await doctorCollection.find().toArray()
      res.send(doctors)
    })

    app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body
      const result = await doctorCollection.insertOne(doctor)
      res.send(result)
    })

    app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email
      const filter = { email: email }
      const result = await doctorCollection.deleteOne(filter)
      res.send(result)
    })
  } finally {
    // await client.close()
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
