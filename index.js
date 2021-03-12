const puppeteer = require('puppeteer');
const firebase = require("firebase/app");
const dayjs = require('dayjs')
const _ = require('lodash');
const zipcodes = require('zipcodes-nearby');

// Add the Firebase products that you want to use
require("firebase/auth");
require("firebase/firestore");

const zipData = require('./data/sc-zips.json');
require('dotenv').config()

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilio = require('twilio')(accountSid, authToken);


let firebaseConfig = {
    apiKey: process.env.GOOGLE_API_KEY,
    authDomain: process.env.FB_AUTH_DOMAIN,
    projectId: process.env.PROJECT_ID,
    storageBucket: process.env.STORAGE_BUCKET,
    messagingSenderId: process.env.MESSAGING_SENDER_ID,
    appId: process.env.APP_ID,
    measurementId: process.env.MEASUREMENT_ID
  };
  
  // Initialize Firebase
  firebase.initializeApp(firebaseConfig);



(async () => {
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  const grab = async () => {
    setTimeout(async () => { 

        await page.goto('https://cvas.dhec.sc.gov/health/CovidVaccineScheduling/SelectLocation', { waitUntil: 'networkidle2' });
        let cityData = zipData.map(x => x.fields)

        let availableLocations = await page.evaluate(() => {

            let data = []
            let elements = document.getElementsByClassName('btn-outline-primary')
            for (var element of elements) {
                let inner = element.innerHTML
                inner = inner.replace('</b>','')
                inner = inner.replace('<b>','')


                let locArray = inner.split("<br>")
                
                let name = locArray[0]
                let streetAddress = locArray[1]
                let cityStateZip = locArray[2]
                        
                data.push({name, streetAddress, cityStateZip, available});
                
            }
            return data
        })

        let availableLocMap = {}

        availableLocations.forEach((loc) => {
            let zipArray = loc.cityStateZip.split(" ")
            let zip = zipArray.length > 1 ? zipArray[zipArray.length - 1] : ''
            let info = _.find(cityData, (item) => item.zip == zip)
            availableLocMap[zip] = {...loc, latitude: info && info.latitude, longitude: info && info.longitude}
        })
        let availableZips = Object.keys(availableLocMap)

        const usersRef = firebase.firestore().collection('users')
        const snapshot = await usersRef.get()

        if (snapshot.empty) {
            console.log('No matching documents.');
            return;
        }  

        const userData = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }))

        for(var user of userData){

            let info = _.find(cityData, (item) => item.zip == user.zipCode)
            if(!info){
                //Need to handle this
                return
            }
            let nearby = zipcodes.near(user.zipCode.toString(), 35000, {datafile: 'data/sc-zips.csv', zipcode: "Zip", long: "Longitude", lat: "Latitude"}).then((nearby) => {
                
                let intersection = _.intersection(availableZips, nearby)

                if(intersection.length > 0){
                    console.log("FOUND A MATCH")
                    let now = dayjs()
                    let lastDate = dayjs(user.lastContacted)
                    let diff = now.diff(lastDate, "minute")
    
                    //Not trying to blow up phones.
                    if(Math.abs(diff) < 30){
                        console.log("Texted user not long ago.")
                        return
                    } else {
                        twilio.messages
                            .create({
                                body: `Available Appointment at ${intersection.join(', ')}. Go to https://cvas.dhec.sc.gov/Health/CovidVaccineScheduling`,
                                from: process.env.TWILIO_PHONE_NUMBER,
                                to: user.phoneNumber
                            }).then(message => {
                                console.log(message.sid)
                                firebase.firestore().collection("users").doc(user.id).update({...user, lastContacted: dayjs().valueOf()});

                            }).catch((e) => {
                                console.error("Twilio Error:", e)
                            })
                    
                    }
                    
                } else {
                    console.log("NO MATCHES")
                }
            })
        }
            
    
        await grab()
    }, 1000)
  }
  await grab()
  
})();