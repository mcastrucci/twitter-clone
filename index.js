const express = require("express");
const app = express();

const { promisify } = require('util')
const bcrypt = require('bcrypt');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);

const redis = require('redis');
const client = redis.createClient();


const ahget = promisify(client.hget).bind(client)
const asmembers = promisify(client.smembers).bind(client)
const ahkeys = promisify(client.hkeys).bind(client)
const aincr = promisify(client.incr).bind(client)
const alrange = promisify(client.lrange).bind(client)


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

app.get("/getFollowersSugestion", async (req, res) => {
    if(!req.session.userid){
        res.redirect("/");
        return;
    }

    console.log("/getFollowersSugestion --- getting people to follow ---");
    try{
        const allUsers = await getAllUsers();  // we get all users from the DB
    
        //we will need the userName from the id of the session
        const userName = await getUserName(req.session.userid);
    
        //now that we have the user name, lets get the followers
        const followSugestion = await getUsersToFollow(userName, allUsers);
    
        //we return that list
        await res.send(followSugestion);
    }catch (ex){
        res.status(500).send("failed to get sugested people to follow");
    }
})



const getFollowedUsers = (userName, users) => new Promise ((resolve, reject) => {
    client.smembers(`following:${userName.trim()}`, (err, following) => {
        if (err)
            reject(err);
        let returningList = [];
        //now lets iterate over the users and remove the ones that should not be there
        for(item of users){
            let push = true;
            if(!following.includes(item))
                push = false;
            if (item === userName)
                push = false;

            if (push)
                returningList.push(item);
        }
        resolve({users: returningList})
    })
})

app.get("/get-tweets", (req, res) => {
    if(!req.session.userid){
        res.redirect("/");
        return;
    }

    let tweets = [];
    
    client.hkeys("users", (err, users)=> {
        if (err){
            res.status(500).send("failed to get people to follow");
            return;
        }

        console.log("getting tweets");
        //in order to get tweets, first lets get the name of the user
        getUserName(req.session.userid).then((userName)=>{
            console.log("tweets -- userName", userName);
            //now that we have the user name, lets get the followers
            console.log(userName, users);
            getFollowedUsers(userName, users).then(followingUsers=>{
                console.log("following users--" , followingUsers)
                //now that we have the people that this user follow, lets get the tweets of each
                for(user of followingUsers.users){
                    //to make this, we will need the id of the user
                    console.log("iterating over following users");
                    client.hget("users", user, (err, userID)=> { //first we get the user ID from DB if it does not exist, we redirect to root
                        console.log("got the id of the followed user", userID);
                        if (err){
                            res.status(500).send("something went wrong, please try again in some minutes");
                            return;
                        }
                        //now we get all posts of the user
                        client.hgetall(`post:${userID}`, (err, listOfPosts) => {
                            console.log("current following user list of post", listOfPosts);
                            //we iterate over the posts
                            if (listOfPosts){
                                for (post of listOfPosts){
                                    let tempPost = {
                                        user: user,
                                        tweet: post.message,
                                        time: post.timestamp
                                    }
                                    tweets.push(tempPost);
                                }
                            }
                        })
                    });
                }

                res.send(JSON.stringify({feed: {
                    tempPost
                }}));

            }).catch(err =>{
                res.status(500).send("failed while getting user name");
            })
        }).catch((err)=>{
            console.log(err);
            res.status(500).send("failed while getting user name");
            return;
        });

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

app.listen(3000, () => console.log("server running"));

//Database Methods

const getAllUsers = async () => await ahkeys("users");

const getUserName = async (userID) => ahget(`user:${userID}`, "username");

const getUsersToFollow = async (userName, users)  => {
    //first we get all people that the current user is following
    const currentUserFollowedPeople = await asmembers (`following:${userName.trim()}`); 
    console.log("---current user is following: ", currentUserFollowedPeople);

    let returningList = [];
    //now lets iterate over the users and remove the ones that should not be there

    for(item of users){
        let push = true;
        if(currentUserFollowedPeople && currentUserFollowedPeople.includes(item))
            push = false;
        if (item === userName)
            push = false;

        if (push)
            returningList.push(item);
    }
    return {users: returningList};
}