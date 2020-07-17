const express = require("express");
const app = express();


const bcrypt = require('bcrypt');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);

const redis = require('redis');
const client = redis.createClient();


const saltRounds = 10;

const __exposedDir = __dirname + "/public/";


app.use(express.urlencoded({ extended: true }))
app.use(express.static(__dirname + "/public"));
app.use(express.json());

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

app.get("/getFollowersSugestion", (req, res) => {
    if(!req.session.userid){
        res.redirect("/");
        return;
    }

    client.hkeys("users", (err, users)=> {
        if (err){
            res.status(500).send("failed to get people to follow");
            return;
        }
        let returningList = [];
        //first we will get the name of the curren user
        getUserName(req.session.userid).then((userName)=>{
            //now that we have the user name, lets get the followers
            console.log(userName);
            client.smembers(`following:${userName.trim()}`, (err, following) => {
                if (err)
                    res.status(500).send("error while getting following users");
                    
                //now lets iterate over the users and remove the ones that should not be there
                console.log(`following:${userName}` ,following);
                for(item of users){
                    console.log(userName, item, userName !== item);
                    let push = true;
                    if(following && following.includes(item))
                        push = false;
                    if (item === userName)
                        push = false;

                    if (push)
                        returningList.push(item);
                }
                res.send({users: returningList});
            })
        }).catch((err)=>{
            console.log(err);
            res.status(500).send("failed while getting user name");
            return;
        })
        
    });
})

app.post("/post", (req, res) => {
    if(req.session.userid){
        const user_tweet = req.body.user_tweet;

        client.incr("postid", async (err, postid) => {
            try {
                if(err){
                    throw err;
                } 
                client.hset(`post:${postid}`, 'userid', req.session.userid, 'message', user_tweet, 'timestamp', Date.now(), (err) =>{
                    if (err)
                        throw err;
                });

                res.redirect("/");
            }catch (ex) {
                console.log(ex);
                res.status(500).send("we are sorry, somthing happend with your post, please try again in a few minutes")
            }
        });

    } else
        res.sendFile(__exposedDir + "signin/signin.html");
})

app.post("/follow", (req, res) =>{
    if(!req.session.userid){
        res.redirect("/");
        return;
    }
    console.log (req.body);
    let { userToFollow } = req.body;
    console.log("requested to follow user "+ userToFollow);
    client.hget("users", userToFollow, (err, userID)=> { //first we get the user ID from DB if it does not exist, we redirect to root
        if (err){
            res.status(500).send("something went wrong, please try again in some minutes");
            return;
        }
        //if userID does exist, we will add (or create if it does not exist) a SET with followers and following
        //first we need the name of our current user
        getUserName(req.session.userid).then((currentUserName) =>{
            //now that we have the current user name, we create a set of following / followers
            console.log("curent user name", currentUserName)
            console.log(userToFollow);

            followUser(currentUserName, userToFollow).then(()=>{
                console.log("ok");
                res.status(200).send(JSON.stringify({response: `you are now following ${userToFollow}`}));
            }).catch(err=> {
                console.log(err);
                res.status(500).send( JSON.stringify({response: err}));
            })
            
        }).catch(err =>{
            console.log(err);
            res.status(500).send(JSON.stringify({response: err}));
        });
    })

    const followUser = (currentUserName, userToFollow) => new Promise((resolve, reject) =>{
        client.sadd(`following:${currentUserName}`, userToFollow, err => {
            reject(err);
        });
        client.sadd(`followers:${userToFollow}`, currentUserName, err => {
            reject(err);
        });
        resolve();
    })

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

const getUserName = (userID) => new Promise ((resolve, reject) => {
    console.log(userID);
    client.hget(`user:${userID}`, "username", (err, currentUserName) =>{
        if (err)
            reject("error while getting user name");
        resolve(currentUserName);
    })
});

app.listen(3000, () => console.log("server running"));