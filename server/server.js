const express = require('express');
const path = require('path');
const bodyParser = require("body-parser");
const axios = require('axios');
const sgMail = require('@sendgrid/mail');
const dayjs = require('dayjs');
const { btoa } = require('buffer');
// const customParseFormat = require('dayjs/plugin/customParseFormat');
// dayjs.extend(customParseFormat);
const app = express();
require('dotenv').config();


const io = require("socket.io")(process.env.PORT, {
  cors: {
    origin: true
  }
})

// Set up the Webserver
app.use(express.static(path.join(__dirname, '../client/build')));
app.use(bodyParser.json())

// Serving the index site
app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
});

// Invoice Webhook
app.post(process.env.WEBHOOK, (req, res) => {

    io.sockets.emit('invoicePaid',req.body.payment_hash)
    res.status(200).end()
})

app.listen(5000);
// Finish Server Setup

// Socket Connections
io.on('connection', (socket) => {
  // console.log("New connection")


  // Checks for a paid Invoice after reconnect
  socket.on('checkInvoice',(clientPaymentHash) => {
    checkInvoice(clientPaymentHash).then(result => io.sockets.emit('invoicePaid',result))
  })

  // Getting the Invoice from lnbits and forwarding it to the frontend
  socket.on('getInvoice',(amount) =>{
    getInvoice(amount).then(result => socket.emit("lnbitsInvoice",result))
  })
  socket.on('sendEmail',(emailAddress,configData,date) => {
  sendEmail(emailAddress,configData,date).then(result => console.log(result))
  })

  socket.on('getWireguardConfig',(publicKey,presharedKey,priceDollar,country) => {
    getWireguardConfig(publicKey,presharedKey,getTimeStamp(priceDollar),getServer(country),priceDollar).then(result => socket.emit('reciveConfigData',result))
  })


});
///Transforms country into server
const getServer = (countrySelector) => {
  let server
  if (countrySelector == 1){
  server = process.env.IP_SINGAPUR
  }
  if (countrySelector == 2){
    server = process.env.IP_USA
  }
  if (countrySelector == 3){
    server = process.env.IP_FIN
  }
  if (countrySelector == 4){
    server = process.env.IP_UK
  }
  if (countrySelector == 5){
    server = process.env.IP_CANADA
  }
  return server
}


// Transforms duration into timestamp
const getTimeStamp = (selectedValue) =>{
  // const date = new Date()
  if(selectedValue == 7){
    date = addMonths(date = new Date(),3)
    return date
  }
  if(selectedValue == 3){
    date = addMonths(date = new Date(),1)
    return date
  }
  if(selectedValue == 1.5){
    date = addWeeks(date = new Date(),1)
    return date
  }
  if(selectedValue == 0.5){
    date = addHour(date = new Date(),24)
    return date
  }

  if(selectedValue == 0.1){
    date = addHour(date = new Date(),1)
    return date
  }

  function addHour (date = new Date(), hour) {
    date.setHours(date.getHours() + hour)
    return date
  }
  function addWeeks (date = new Date(), weeks) {
    date.setDate(date.getDate() + weeks * 7)
    return date
  }

  function addMonths(date = new Date(), months) {
    const d = date.getDate();
    date.setMonth(date.getMonth() + +months);
    if (date.getDate() != d) {
      date.setDate(0);
    }
    return date;
  }

}


// Get Invoice Function
async function getInvoice(amount) {
  const satoshis = await getPrice().then((result) => {return result});
  return axios({
  method: "post",
  url: process.env.URL_INVOICE_API,
  headers: { "X-Api-Key": process.env.INVOICE_KEY},
  data: {
    "out": false,
    "amount": satoshis * amount,
    "memo": "LNVPN",
    "webhook" : process.env.URL_WEBHOOK
  }
    }).then(function (response){
      const payment_request = response.data.payment_request;
      const payment_hash = response.data.payment_hash;
      return { payment_hash, payment_request };
    }).catch(error => error);
}

// Get Bitcoin Price in Satoshi per Dollar
async function getPrice() {
  return axios({
    method: "get",
    url: process.env.URL_PRICE_API
  }).then(function (response){
     return 100_000_000 / response.data.USD.buy;
  })
};


// Get Wireguard Config
async function getWireguardConfig(publicKey, presharedKey, timestamp, server, priceDollar) {

  return axios({
    method: "post",
    url: server,
    headers: {
      'Content-Type': 'application/json',
      'Authorization' : process.env.AUTH
      },
    data: {
      "publicKey": publicKey,
      "presharedKey": presharedKey,
      "bwLimit": 10000*priceDollar,
      "subExpiry": parseDate(timestamp),
      "ipIndex": 0
    }
  }).then(function (response){
    return response.data;
  }).catch(error => {
    console.error(error)
    return error;
  });
}
// Parse Date object to string format: YYYY-MMM-DD hh:mm:ss A
const parseDate = (date) => {
  return dayjs(date).format("YYYY-MMM-DD hh:mm:ss A");
}


// Send Wireguard config file via email
async function sendEmail(emailAddress,configData, date) {
  sgMail.setApiKey(process.env.EMAIL_TOKEN);
    const msg = {
      to: emailAddress,
      from: 'thanks@lnvpn.net', // Use the email address or domain you verified above
      subject: `Your LNVPN config file for Wireguard. Valid until: ${+date.toString()}`,
      text: `Thank you for using lnvpn.net. Find your personal config File attached. Don't lose it.\n Your subscription is valid until: ${+date.toString()}`,
      attachments: [
        {
          content: btoa(configData),
          filename: 'wireguard.conf',
          type : "text/plain",
          endings:'native',
          disposition: 'attachment'
        }
      ],
    };

    sgMail
      .send(msg)
      .then(() => {}, error => {
        console.error(error);

        if (error.response) {
          console.error(error.response.body)
        }
      });
}

    // Check for Invoice
    async function checkInvoice(hash) {
      return axios({
        method: "get",
        url: `https://legend.lnbits.com/api/v1/payments/${hash}`,
        headers: { "X-Api-Key": process.env.INVOICE_KEY}
      }).then(function (response){
          if(response.data.paid)  {
            return response.data.details.payment_hash;
          }
      })
    }








