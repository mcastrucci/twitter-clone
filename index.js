const express = require("express");

const redis = require('redis')
const bcrypt = require('bcrypt');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);

const client = redis.createClient()
const saltRounds = 10;
const app = express();
const __exposedDir = __dirname + "/public/";


app.use(express.urlencoded({ extended: true }))
app.use(express.static(__dirname + "/public"));

app.use(
    session({
      store: new RedisStore({ client: client }),
      resave: true,
      saveUninitialized: true,
      cookie: {
        maxAge: 36000000, //10 hours, in milliseconds
        httpOnly: false,
        secure: false,
      },
      secret: 'eN01gOXUV2HN21OnBhWF',
    })
  )

app.get("/", (req, res) => {
    if(req.session.userid)
        res.sendfile(__exposedDir + "dashboard/home.html")
    else
        res.sendFile(__exposedDir + "signin/signin.html");
})

app.post("/signin", (req, res)=>{
    //well, this should not happen
    let { email, password } = req.body;
    if(!email || !password)
     res.send("error!");

     //if everyting is ok, we will proceed to check if the user exist in our redit DB
    client.hget("users", email, (err, userID)=>{
        if (err){
            console.log("an error ocurred while sining in");
            res.send("something failed, we are working on it!");
            return;
        }
        if (userID){ //in this case user does exist, we will log in
            handleLogin(userID, password);
        }else { //user does not exist, we will register
            handleSignup(email, password)
        }
    });

    const handleLogin = (idFromDB, password) => {
        client.hget(`user:${idFromDB}`, 'hash', async (err, hash) =>{
            let result = await bcrypt.compare(password, hash);
            if(result){ //everything ine, lets redirect him to dashboard
                saveSessionAndRedirectToDashboard(idFromDB);
            }else
                res.send("wrong password!");
            return;
                
        })
    }

    const handleSignup = (email, password) => {
        client.incr('userid', async (err, userIdFromDb) => { // in our DB structure, we increment the ID, this is a new user
            if (err){
                console.log("something went wrong during the registration processs");
                res.send("something failed, we are working on it!");
                return;
            }
            client.hset('users', email, userIdFromDb) // we create a new username and we match it with the new ID
            //now we will store the hash of the password
            const hash = await bcrypt.hash(password, saltRounds);
            //finally, we will create an entry userID - user email - hash
            client.hset(`user:${userIdFromDb}`, 'hash', hash, 'username', email);
            saveSessionAndRedirectToDashboard(userIdFromDb);
            return;
        });    
    }
    const saveSessionAndRedirectToDashboard = (userID) => {
        req.session.userid = userID;
        req.session.save();
        res.status(200).sendFile(__exposedDir + "dashboard/home.html");
    };
})



app.listen(3000, () => console.log("server running"));